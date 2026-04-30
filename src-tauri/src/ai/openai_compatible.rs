use super::errors;
use super::provider::{
    AiProviderChatRequest, AiProviderMessage, AiProviderResponse, AiProviderToolCall,
    AiProviderToolSpec,
};
use super::redaction::redact_text;
use super::transport::sse::{parse_sse_line, SseParseOutcome};
use reqwest::header::{ACCEPT, ACCEPT_ENCODING};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::Duration;

const PROVIDER_REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const PROVIDER_STREAM_TIMEOUT: Duration = Duration::from_secs(180);
const PROVIDER_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_PROVIDER_ERROR_BODY_CHARS: usize = 600;

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionMessage {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<OpenAiToolCall>,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCall {
    id: Option<String>,
    #[serde(default)]
    r#type: String,
    function: Option<OpenAiToolCallFunction>,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCallFunction {
    name: String,
    arguments: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionStreamChunk {
    #[serde(default)]
    choices: Vec<ChatCompletionStreamChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionStreamChoice {
    #[serde(default)]
    delta: Option<ChatCompletionStreamDelta>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionStreamDelta {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<OpenAiStreamToolCall>,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamToolCall {
    index: Option<usize>,
    id: Option<String>,
    function: Option<OpenAiStreamToolCallFunction>,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamToolCallFunction {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Debug, Default)]
struct StreamResponseAccumulator {
    content: String,
    tool_calls: BTreeMap<usize, PartialStreamToolCall>,
}

#[derive(Debug, Default)]
struct PartialStreamToolCall {
    id: Option<String>,
    name: String,
    arguments: String,
}

pub async fn chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: AiProviderChatRequest,
) -> Result<AiProviderResponse, String> {
    let base_url = validate_base_url(base_url)?;
    let api_key = validate_api_key(api_key)?;
    let model = validate_model(model)?;

    match chat_non_streaming(&base_url, api_key, model, request.clone()).await {
        Ok(response) => Ok(response),
        Err(non_stream_error) if should_retry_chat_as_stream(&non_stream_error) => {
            match chat_stream_response(&base_url, api_key, model, request).await {
                Ok(response) => Ok(response),
                Err(stream_error) => Err(errors::error(
                    "AI_PROVIDER_UNAVAILABLE",
                    format!(
                        "AI Provider 非流式响应读取失败，流式兜底也失败。非流式错误：{}；流式错误：{}",
                        summarize_body(&non_stream_error),
                        summarize_body(&stream_error)
                    ),
                )),
            }
        }
        Err(error) => Err(error),
    }
}

async fn chat_non_streaming(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: AiProviderChatRequest,
) -> Result<AiProviderResponse, String> {
    let client = build_provider_client(PROVIDER_REQUEST_TIMEOUT)?;

    let body = build_chat_request_body(model, request, false);

    let response = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(api_key)
        .header(ACCEPT, "application/json")
        .header(ACCEPT_ENCODING, "identity")
        .json(&body)
        .send()
        .await
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    let status = response.status();
    let body = read_response_body_lossy(response).await?;

    ensure_success_status(status, &body)?;

    parse_chat_completion_response(&body, model)
}

async fn chat_stream_response(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: AiProviderChatRequest,
) -> Result<AiProviderResponse, String> {
    let client = build_provider_client(PROVIDER_STREAM_TIMEOUT)?;

    let body = build_chat_request_body(model, request, true);

    let mut response = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(api_key)
        .header(ACCEPT, "text/event-stream")
        .header(ACCEPT_ENCODING, "identity")
        .json(&body)
        .send()
        .await
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    let status = response.status();

    if !status.is_success() {
        let body = read_response_body_lossy(response).await?;

        return match ensure_success_status(status, &body) {
            Ok(()) => Err(errors::error(
                "AI_PROVIDER_UNAVAILABLE",
                "AI Provider 流式响应状态异常。",
            )),
            Err(error) => Err(error),
        };
    }

    let mut buffer: Vec<u8> = Vec::new();
    let mut accumulator = StreamResponseAccumulator::default();

    while let Some(chunk) = response.chunk().await.map_err(|error| {
        errors::error(
            "AI_PROVIDER_UNAVAILABLE",
            format!(
                "读取 AI Provider 流式响应失败：{}",
                provider_body_read_error_message(&error)
            ),
        )
    })? {
        buffer.extend_from_slice(&chunk);

        for line in drain_complete_utf8_lines(&mut buffer)? {
            if apply_stream_line(&line, &mut accumulator)? {
                return stream_accumulator_to_response(accumulator, model);
            }
        }
    }

    if has_non_whitespace_bytes(&buffer) {
        let line = decode_stream_line_bytes(buffer)?;
        apply_stream_line(&line, &mut accumulator)?;
    }

    stream_accumulator_to_response(accumulator, model)
}

pub async fn chat_stream<F, C>(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: AiProviderChatRequest,
    mut on_delta: F,
    is_cancelled: C,
) -> Result<(), String>
where
    F: FnMut(String) -> Result<(), String>,
    C: Fn() -> bool,
{
    let base_url = validate_base_url(base_url)?;
    let api_key = validate_api_key(api_key)?;
    let model = validate_model(model)?;

    if is_cancelled() {
        return Err(errors::error("AI_REQUEST_CANCELLED", "AI 请求已取消。"));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(PROVIDER_CONNECT_TIMEOUT)
        .timeout(PROVIDER_STREAM_TIMEOUT)
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .build()
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    let body = build_chat_request_body(model, request, true);

    let mut response = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(api_key)
        .header(ACCEPT, "text/event-stream")
        .header(ACCEPT_ENCODING, "identity")
        .json(&body)
        .send()
        .await
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    let status = response.status();

    if !status.is_success() {
        let body = read_response_body_lossy(response).await?;

        return ensure_success_status(status, &body);
    }

    let mut buffer: Vec<u8> = Vec::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?
    {
        if is_cancelled() {
            return Err(errors::error("AI_REQUEST_CANCELLED", "AI 请求已取消。"));
        }

        buffer.extend_from_slice(&chunk);

        for line in drain_complete_utf8_lines(&mut buffer)? {
            if is_cancelled() {
                return Err(errors::error("AI_REQUEST_CANCELLED", "AI 请求已取消。"));
            }

            let should_finish = handle_sse_line(&line, &mut on_delta)?;

            if should_finish {
                return Ok(());
            }
        }
    }

    if is_cancelled() {
        return Err(errors::error("AI_REQUEST_CANCELLED", "AI 请求已取消。"));
    }

    if has_non_whitespace_bytes(&buffer) {
        let line = decode_stream_line_bytes(buffer)?;
        let should_finish = handle_sse_line(&line, &mut on_delta)?;

        if should_finish {
            return Ok(());
        }
    }

    Ok(())
}

pub async fn test(base_url: &str, api_key: &str, model: &str) -> Result<(), String> {
    let request = AiProviderChatRequest::new(vec![AiProviderMessage {
        role: "user".to_string(),
        content: "ping".to_string(),
    }]);

    chat(base_url, api_key, model, request).await.map(|_| ())
}

fn build_provider_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(PROVIDER_CONNECT_TIMEOUT)
        .timeout(timeout)
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .build()
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))
}

fn build_chat_messages(messages: Vec<AiProviderMessage>) -> Vec<Value> {
    messages
        .into_iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect()
}

async fn read_response_body_lossy(response: reqwest::Response) -> Result<String, String> {
    let bytes = response.bytes().await.map_err(|error| {
        errors::error(
            "AI_PROVIDER_UNAVAILABLE",
            format!(
                "读取 AI Provider 响应体失败：{}",
                provider_body_read_error_message(&error)
            ),
        )
    })?;

    Ok(response_body_bytes_to_string(bytes.as_ref()))
}

fn response_body_bytes_to_string(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .to_string()
}

fn drain_complete_utf8_lines(buffer: &mut Vec<u8>) -> Result<Vec<String>, String> {
    let mut lines = Vec::new();

    while let Some(line_end) = buffer.iter().position(|byte| *byte == b'\n') {
        let line_bytes = buffer.drain(..=line_end).collect::<Vec<u8>>();
        lines.push(decode_stream_line_bytes(line_bytes)?);
    }

    Ok(lines)
}

fn decode_stream_line_bytes(mut line_bytes: Vec<u8>) -> Result<String, String> {
    if line_bytes.ends_with(b"\n") {
        line_bytes.pop();
    }

    if line_bytes.ends_with(b"\r") {
        line_bytes.pop();
    }

    String::from_utf8(line_bytes).map_err(|error| {
        errors::error(
            "AI_PROVIDER_UNAVAILABLE",
            format!("AI Provider 流式响应包含非法 UTF-8：{error}"),
        )
    })
}

fn has_non_whitespace_bytes(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .any(|byte| !matches!(*byte, b' ' | b'\t' | b'\r' | b'\n'))
}

fn provider_body_read_error_message(error: &reqwest::Error) -> String {
    if error.is_decode() {
        return "Provider 返回体解码失败。已请求 identity 编码，请检查该兼容网关是否返回了损坏压缩、错误 Content-Encoding 或被中途截断的响应。"
            .to_string();
    }

    error.to_string()
}

fn build_chat_request_body(
    model: &str,
    request: AiProviderChatRequest,
    stream: bool,
) -> serde_json::Value {
    let mut body = json!({
        "model": model,
        "messages": build_chat_messages(request.messages),
        "temperature": 0.2,
        "stream": stream,
    });

    if request.force_tool_choice_none {
        body["tool_choice"] = json!("none");
    } else if !request.tools.is_empty() {
        body["tools"] = json!(build_chat_tools(request.tools));
        body["tool_choice"] = json!("auto");
    }

    body
}

fn build_chat_tools(tools: Vec<AiProviderToolSpec>) -> Vec<Value> {
    tools
        .into_iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                }
            })
        })
        .collect()
}

fn parse_chat_completion_response(body: &str, model: &str) -> Result<AiProviderResponse, String> {
    let parsed = serde_json::from_str::<ChatCompletionResponse>(body).map_err(|error| {
        errors::error(
            "AI_RESPONSE_INVALID",
            format!("AI Provider 非流式响应 JSON 解析失败：{error}"),
        )
    })?;

    let Some(choice) = parsed.choices.into_iter().next() else {
        return Err(errors::error(
            "AI_RESPONSE_INVALID",
            "AI Provider did not return a completion choice.",
        ));
    };

    let content = choice
        .message
        .content
        .unwrap_or_default()
        .trim()
        .to_string();
    let tool_calls = normalize_openai_tool_calls(choice.message.tool_calls)?;

    if content.is_empty() && tool_calls.is_empty() {
        return Err(errors::error(
            "AI_RESPONSE_INVALID",
            "AI Provider did not return content or tool calls.",
        ));
    }

    Ok(AiProviderResponse::with_tool_calls(
        content,
        model.to_string(),
        tool_calls,
    ))
}

fn normalize_openai_tool_calls(
    tool_calls: Vec<OpenAiToolCall>,
) -> Result<Vec<AiProviderToolCall>, String> {
    tool_calls
        .into_iter()
        .enumerate()
        .filter(|(_, call)| call.r#type.is_empty() || call.r#type == "function")
        .map(|(index, call)| {
            let function = call.function.ok_or_else(|| {
                errors::error(
                    "AI_RESPONSE_INVALID",
                    "Tool call is missing function payload.",
                )
            })?;
            let name = function.name.trim();
            if name.is_empty() {
                return Err(errors::error(
                    "AI_RESPONSE_INVALID",
                    "Tool call function name is empty.",
                ));
            }
            let arguments = if function.arguments.trim().is_empty() {
                Value::Object(serde_json::Map::new())
            } else {
                serde_json::from_str::<Value>(&function.arguments).map_err(|error| {
                    errors::error(
                        "AI_RESPONSE_INVALID",
                        format!("Tool call arguments are not valid JSON: {error}"),
                    )
                })?
            };

            Ok(AiProviderToolCall {
                id: call.id.unwrap_or_else(|| format!("tool-call-{index}")),
                name: name.to_string(),
                arguments,
            })
        })
        .collect()
}

fn should_retry_chat_as_stream(error: &str) -> bool {
    error.contains("读取 AI Provider 响应体失败")
        || error.contains("响应体解码失败")
        || error.contains("Provider 返回体解码失败")
        || error.contains("AI Provider 非流式响应 JSON 解析失败")
        || error.to_ascii_lowercase().contains("decode")
}

fn apply_stream_line(
    line: &str,
    accumulator: &mut StreamResponseAccumulator,
) -> Result<bool, String> {
    let trimmed = line.trim();

    if trimmed.is_empty() || trimmed.starts_with(':') {
        return Ok(false);
    }

    let Some(data) = trimmed.strip_prefix("data:") else {
        return Ok(false);
    };

    let payload = data.trim();

    if payload.is_empty() {
        return Ok(false);
    }

    if payload == "[DONE]" {
        return Ok(true);
    }

    apply_stream_payload(payload, accumulator)?;

    Ok(false)
}

fn apply_stream_payload(
    payload: &str,
    accumulator: &mut StreamResponseAccumulator,
) -> Result<(), String> {
    let parsed = serde_json::from_str::<ChatCompletionStreamChunk>(payload).map_err(|error| {
        errors::error(
            "AI_RESPONSE_INVALID",
            format!("AI Provider 流式响应 chunk 解析失败：{error}"),
        )
    })?;

    for choice in parsed.choices {
        let Some(delta) = choice.delta else {
            continue;
        };

        if let Some(content) = delta.content {
            accumulator.content.push_str(&content);
        }

        for tool_call in delta.tool_calls {
            let index = tool_call.index.unwrap_or(accumulator.tool_calls.len());
            let partial = accumulator.tool_calls.entry(index).or_default();

            if let Some(id) = tool_call.id.filter(|id| !id.trim().is_empty()) {
                partial.id.get_or_insert(id);
            }

            let Some(function) = tool_call.function else {
                continue;
            };

            if let Some(name) = function.name.filter(|name| !name.trim().is_empty()) {
                if partial.name.is_empty() {
                    partial.name = name;
                } else if partial.name != name {
                    partial.name.push_str(&name);
                }
            }

            if let Some(arguments) = function.arguments {
                partial.arguments.push_str(&arguments);
            }
        }
    }

    Ok(())
}

fn stream_accumulator_to_response(
    accumulator: StreamResponseAccumulator,
    model: &str,
) -> Result<AiProviderResponse, String> {
    let content = accumulator.content.trim().to_string();
    let tool_calls = normalize_stream_tool_calls(accumulator.tool_calls)?;

    if content.is_empty() && tool_calls.is_empty() {
        return Err(errors::error(
            "AI_RESPONSE_INVALID",
            "AI Provider 流式响应未返回文本或工具调用。",
        ));
    }

    Ok(AiProviderResponse::with_tool_calls(
        content,
        model.to_string(),
        tool_calls,
    ))
}

fn normalize_stream_tool_calls(
    tool_calls: BTreeMap<usize, PartialStreamToolCall>,
) -> Result<Vec<AiProviderToolCall>, String> {
    tool_calls
        .into_iter()
        .map(|(index, call)| {
            let name = call.name.trim();

            if name.is_empty() {
                return Err(errors::error(
                    "AI_RESPONSE_INVALID",
                    "流式工具调用缺少 function.name。",
                ));
            }

            let arguments = if call.arguments.trim().is_empty() {
                Value::Object(serde_json::Map::new())
            } else {
                serde_json::from_str::<Value>(&call.arguments).map_err(|error| {
                    errors::error(
                        "AI_RESPONSE_INVALID",
                        format!("流式工具调用参数不是合法 JSON：{error}"),
                    )
                })?
            };

            Ok(AiProviderToolCall {
                id: call.id.unwrap_or_else(|| format!("tool-call-{index}")),
                name: name.to_string(),
                arguments,
            })
        })
        .collect()
}

fn handle_sse_line<F>(line: &str, on_delta: &mut F) -> Result<bool, String>
where
    F: FnMut(String) -> Result<(), String>,
{
    let (outcome, delta) =
        parse_sse_line(line).map_err(|error| errors::error("AI_RESPONSE_INVALID", error))?;

    if let Some(delta) = delta {
        if !delta.is_empty() {
            on_delta(delta)?;
        }
    }

    Ok(matches!(outcome, SseParseOutcome::Done))
}

fn ensure_success_status(status: StatusCode, body: &str) -> Result<(), String> {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(errors::error(
            "AI_PROVIDER_AUTH_FAILED",
            "AI Provider 鉴权失败。",
        ));
    }

    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(errors::error(
            "AI_PROVIDER_RATE_LIMITED",
            "AI Provider 触发限流。",
        ));
    }

    if !status.is_success() {
        return Err(errors::error(
            "AI_PROVIDER_UNAVAILABLE",
            format!("AI Provider 返回错误 {status}: {}", summarize_body(body)),
        ));
    }

    Ok(())
}

fn validate_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');

    if trimmed.is_empty() {
        return Err(errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "请填写 Provider API 地址。",
        ));
    }

    if !is_allowed_base_url(trimmed) {
        return Err(errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "AI Provider 地址必须使用 HTTPS；本地调试仅允许 http://localhost、http://127.0.0.1 或 http://[::1]。",
        ));
    }

    Ok(trimmed.to_string())
}

fn is_allowed_base_url(value: &str) -> bool {
    value.starts_with("https://")
        || value.starts_with("http://localhost")
        || value.starts_with("http://127.0.0.1")
        || value.starts_with("http://[::1]")
}

fn validate_api_key(value: &str) -> Result<&str, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(errors::error("AI_PROVIDER_AUTH_FAILED", "请填写 API Key。"));
    }

    Ok(trimmed)
}

fn validate_model(value: &str) -> Result<&str, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(errors::error(
            "AI_PROVIDER_NOT_CONFIGURED",
            "请填写或选择模型名称。",
        ));
    }

    Ok(trimmed)
}

fn summarize_body(value: &str) -> String {
    redact_text(value)
        .text
        .chars()
        .take(MAX_PROVIDER_ERROR_BODY_CHARS)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        apply_stream_line, build_chat_request_body, chat, drain_complete_utf8_lines,
        parse_chat_completion_response, response_body_bytes_to_string,
        stream_accumulator_to_response, summarize_body, validate_base_url,
        StreamResponseAccumulator,
    };
    use crate::ai::provider::{AiProviderChatRequest, AiProviderMessage, AiProviderToolSpec};
    use serde_json::json;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    #[test]
    fn summarize_body_redacts_provider_error_secrets() {
        let summary = summarize_body(r#"{"error":"bad","api_key":"sk-test-secret-value"}"#);

        assert!(!summary.contains("sk-test-secret-value"));
        assert!(summary.contains("[已脱敏：疑似敏感内容]"));
    }

    #[test]
    fn validate_base_url_accepts_https() {
        let value = validate_base_url("https://api.openai.com/v1/").unwrap();

        assert_eq!(value, "https://api.openai.com/v1");
    }

    #[test]
    fn validate_base_url_accepts_localhost_debug_urls() {
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_base_url("http://[::1]:11434/v1").is_ok());
    }

    #[test]
    fn validate_base_url_rejects_plain_http_remote_urls() {
        assert!(validate_base_url("http://example.com/v1").is_err());
    }

    #[test]
    fn parses_openai_tool_calls_without_text_content() {
        let body = r#"{
          "choices": [{
            "message": {
              "content": null,
              "tool_calls": [{
                "id": "call-1",
                "type": "function",
                "function": {
                  "name": "search_text",
                  "arguments": "{\"query\":\"agent\",\"maxResults\":3}"
                }
              }]
            }
          }]
        }"#;

        let response = parse_chat_completion_response(body, "gpt-test").expect("response");

        assert_eq!(response.content, "");
        assert_eq!(response.model, "gpt-test");
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].name, "search_text");
        assert_eq!(response.tool_calls[0].arguments["query"], "agent");
    }

    #[test]
    fn chat_request_body_includes_tool_specs_when_present() {
        let request = AiProviderChatRequest::new(vec![AiProviderMessage::user("inspect")])
            .with_tools(vec![AiProviderToolSpec {
                name: "get_project_tree".to_string(),
                description: "Read project tree.".to_string(),
                parameters: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {}
                }),
            }]);

        let body = build_chat_request_body("gpt-test", request, false);

        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(
            body["tools"][0]["function"]["name"],
            json!("get_project_tree")
        );
        assert_eq!(body["stream"], false);
    }

    #[test]
    fn chat_request_body_can_force_no_tool_choice_for_final_answer() {
        let request = AiProviderChatRequest::new(vec![AiProviderMessage::user("answer now")])
            .with_tool_choice_none();

        let body = build_chat_request_body("gpt-test", request, false);

        assert_eq!(body["tool_choice"], "none");
        assert!(body["tools"].is_null());
    }

    #[test]
    fn response_body_bytes_to_string_handles_bom_and_invalid_utf8_lossily() {
        let body = response_body_bytes_to_string(&[
            0xef, 0xbb, 0xbf, b'{', b'"', b'a', b'"', b':', 0xff, b'}',
        ]);

        assert!(!body.starts_with('\u{feff}'));
        assert!(body.contains('�'));
    }

    #[test]
    fn stream_line_buffer_waits_for_complete_utf8_line_before_decoding() {
        let line = "data: {\"choices\":[{\"delta\":{\"content\":\"你好🙂\"}}]}\n";
        let split_at = line.find('你').expect("line should contain chinese") + 2;
        let bytes = line.as_bytes();
        let mut buffer = Vec::new();

        buffer.extend_from_slice(&bytes[..split_at]);
        let lines = drain_complete_utf8_lines(&mut buffer).expect("partial chunk should parse");
        assert!(lines.is_empty());

        buffer.extend_from_slice(&bytes[split_at..]);
        let lines = drain_complete_utf8_lines(&mut buffer).expect("full line should parse");

        assert_eq!(lines, vec![line.trim_end_matches('\n').to_string()]);
        assert!(!lines[0].contains('�'));
        assert!(buffer.is_empty());
    }

    #[test]
    fn stream_line_buffer_supports_lf_and_crlf_line_endings() {
        let mut buffer =
            b"data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\r\ndata: [DONE]\n".to_vec();

        let lines = drain_complete_utf8_lines(&mut buffer).expect("lines should decode");

        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines[0],
            "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}"
        );
        assert_eq!(lines[1], "data: [DONE]");
        assert!(buffer.is_empty());
    }

    #[test]
    fn stream_line_done_marker_returns_finish_without_waiting_more_chunks() {
        let mut accumulator = StreamResponseAccumulator::default();

        let should_finish =
            apply_stream_line("data: [DONE]", &mut accumulator).expect("done should parse");

        assert!(should_finish);
        assert!(accumulator.content.is_empty());
        assert!(accumulator.tool_calls.is_empty());
    }

    #[test]
    fn stream_payload_ignores_empty_and_role_only_delta() {
        let mut accumulator = StreamResponseAccumulator::default();

        let empty_delta =
            apply_stream_line(r#"data: {"choices":[{"delta":{}}]}"#, &mut accumulator)
                .expect("empty delta should parse");
        let role_delta = apply_stream_line(
            r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#,
            &mut accumulator,
        )
        .expect("role-only delta should parse");
        let content_delta = apply_stream_line(
            r#"data: {"choices":[{"delta":{"content":"ok"}}]}"#,
            &mut accumulator,
        )
        .expect("content delta should parse");

        assert!(!empty_delta);
        assert!(!role_delta);
        assert!(!content_delta);
        assert_eq!(accumulator.content, "ok");
        assert!(accumulator.tool_calls.is_empty());
    }

    #[test]
    fn stream_tool_calls_merge_by_index_and_parse_arguments_after_all_fragments() {
        let mut accumulator = StreamResponseAccumulator::default();
        let first_chunk = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [
                        {
                            "index": 1,
                            "id": "call-2",
                            "function": {
                                "name": "search_",
                                "arguments": "{\"query\""
                            }
                        },
                        {
                            "index": 0,
                            "id": "call-1",
                            "function": {
                                "name": "read_",
                                "arguments": "{\"path\""
                            }
                        }
                    ]
                }
            }]
        });
        let second_chunk = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [
                        {
                            "index": 1,
                            "function": {
                                "name": "text",
                                "arguments": ":\"agent\"}"
                            }
                        },
                        {
                            "index": 0,
                            "function": {
                                "name": "file",
                                "arguments": ":\"test.sh\"}"
                            }
                        }
                    ]
                }
            }]
        });

        apply_stream_line(&format!("data: {first_chunk}"), &mut accumulator)
            .expect("first fragmented tool call chunk should parse");
        apply_stream_line(&format!("data: {second_chunk}"), &mut accumulator)
            .expect("second fragmented tool call chunk should parse");

        let response = stream_accumulator_to_response(accumulator, "test-model")
            .expect("tool calls should parse only after all fragments");

        assert_eq!(response.tool_calls.len(), 2);
        assert_eq!(response.tool_calls[0].id, "call-1");
        assert_eq!(response.tool_calls[0].name, "read_file");
        assert_eq!(response.tool_calls[0].arguments["path"], "test.sh");
        assert_eq!(response.tool_calls[1].id, "call-2");
        assert_eq!(response.tool_calls[1].name, "search_text");
        assert_eq!(response.tool_calls[1].arguments["query"], "agent");
    }

    #[tokio::test]
    async fn chat_uses_identity_non_streaming_request_and_ignores_bad_encoding_header() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server address should be available");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("client should connect");
            let mut reader = BufReader::new(stream.try_clone().expect("stream should clone"));
            let mut headers = String::new();
            let mut content_length = 0usize;

            loop {
                let mut line = String::new();
                reader
                    .read_line(&mut line)
                    .expect("header line should read");
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                let lower = line.to_ascii_lowercase();
                if let Some(value) = lower.strip_prefix("content-length:") {
                    content_length = value.trim().parse().expect("content-length should parse");
                }
                headers.push_str(&lower);
            }

            let mut body = vec![0u8; content_length];
            reader
                .read_exact(&mut body)
                .expect("request body should read");
            let body = String::from_utf8(body).expect("request body should be utf-8");

            assert!(headers.contains("accept-encoding: identity"));
            assert!(body.contains("\"stream\":false"));

            let response_body = r#"{"choices":[{"message":{"content":"ok"}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
        });

        let request = AiProviderChatRequest::new(vec![AiProviderMessage::user("ping")]);
        let response = chat(
            &format!("http://{address}/v1"),
            "test-key",
            "test-model",
            request,
        )
        .await
        .expect("plain JSON with a bad encoding header should still parse");

        server.join().expect("test server should finish");
        assert_eq!(response.content, "ok");
    }

    #[tokio::test]
    async fn chat_falls_back_to_stream_when_non_streaming_body_decode_fails() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server address should be available");
        let server = std::thread::spawn(move || {
            let (mut first_stream, _) = listener.accept().expect("first client should connect");
            let first_request = read_http_request(&mut first_stream);
            assert!(first_request.headers.contains("accept-encoding: identity"));
            assert!(first_request.body.contains("\"stream\":false"));

            let broken_chunked_response = concat!(
                "HTTP/1.1 200 OK\r\n",
                "Content-Type: application/json\r\n",
                "Transfer-Encoding: chunked\r\n",
                "Connection: close\r\n",
                "\r\n",
                "not-a-valid-chunk\r\n"
            );
            first_stream
                .write_all(broken_chunked_response.as_bytes())
                .expect("broken response should write");

            let (mut second_stream, _) = listener.accept().expect("second client should connect");
            let second_request = read_http_request(&mut second_stream);
            assert!(second_request.headers.contains("accept: text/event-stream"));
            assert!(second_request.headers.contains("accept-encoding: identity"));
            assert!(second_request.body.contains("\"stream\":true"));

            write_http_response(
                &mut second_stream,
                "text/event-stream",
                "data: {\"choices\":[{\"delta\":{\"content\":\"兜底成功\"}}]}\n\ndata: [DONE]\n\n",
            );
        });

        let request = AiProviderChatRequest::new(vec![AiProviderMessage::user("ping")]);
        let response = chat(
            &format!("http://{address}/v1"),
            "test-key",
            "test-model",
            request,
        )
        .await
        .expect("stream fallback should recover from body decode failure");

        server.join().expect("test server should finish");
        assert_eq!(response.content, "兜底成功");
        assert!(response.tool_calls.is_empty());
    }

    #[tokio::test]
    async fn chat_falls_back_to_stream_and_reassembles_tool_calls() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server address should be available");
        let server = std::thread::spawn(move || {
            let (mut first_stream, _) = listener.accept().expect("first client should connect");
            let first_request = read_http_request(&mut first_stream);
            assert!(first_request.body.contains("\"stream\":false"));
            write_http_response(&mut first_stream, "application/json", "not-json");

            let (mut second_stream, _) = listener.accept().expect("second client should connect");
            let second_request = read_http_request(&mut second_stream);
            assert!(second_request.body.contains("\"stream\":true"));

            let first_chunk = json!({
                "choices": [{
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "id": "call-1",
                            "function": {
                                "name": "read_",
                                "arguments": "{\"path\""
                            }
                        }]
                    }
                }]
            });
            let second_chunk = json!({
                "choices": [{
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "function": {
                                "name": "file",
                                "arguments": ":\"test.sh\"}"
                            }
                        }]
                    }
                }]
            });
            let response_body = format!(
                "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                first_chunk, second_chunk
            );
            write_http_response(&mut second_stream, "text/event-stream", &response_body);
        });

        let request = AiProviderChatRequest::new(vec![AiProviderMessage::user("read file")])
            .with_tools(vec![AiProviderToolSpec {
                name: "read_file".to_string(),
                description: "Read file.".to_string(),
                parameters: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"]
                }),
            }]);
        let response = chat(
            &format!("http://{address}/v1"),
            "test-key",
            "test-model",
            request,
        )
        .await
        .expect("stream fallback should reassemble tool calls");

        server.join().expect("test server should finish");
        assert_eq!(response.content, "");
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id, "call-1");
        assert_eq!(response.tool_calls[0].name, "read_file");
        assert_eq!(response.tool_calls[0].arguments["path"], "test.sh");
    }

    #[test]
    fn rejects_invalid_tool_call_arguments() {
        let body = r#"{
          "choices": [{
            "message": {
              "content": null,
              "tool_calls": [{
                "id": "call-1",
                "type": "function",
                "function": {
                  "name": "search_text",
                  "arguments": "{broken"
                }
              }]
            }
          }]
        }"#;

        let error = parse_chat_completion_response(body, "gpt-test")
            .expect_err("invalid arguments should fail");

        assert!(error.contains("AI_RESPONSE_INVALID"));
    }

    struct TestHttpRequest {
        headers: String,
        body: String,
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> TestHttpRequest {
        let mut reader = BufReader::new(stream.try_clone().expect("stream should clone"));
        let mut headers = String::new();
        let mut content_length = 0usize;

        loop {
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .expect("header line should read");
            if line == "\r\n" || line.is_empty() {
                break;
            }
            let lower = line.to_ascii_lowercase();
            if let Some(value) = lower.strip_prefix("content-length:") {
                content_length = value.trim().parse().expect("content-length should parse");
            }
            headers.push_str(&lower);
        }

        let mut body = vec![0u8; content_length];
        reader
            .read_exact(&mut body)
            .expect("request body should read");
        let body = String::from_utf8(body).expect("request body should be utf-8");

        TestHttpRequest { headers, body }
    }

    fn write_http_response(stream: &mut std::net::TcpStream, content_type: &str, body: &str) {
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("response should write");
    }
}
