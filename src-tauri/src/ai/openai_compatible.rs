use super::errors;
use super::provider::{AiProviderChatRequest, AiProviderMessage, AiProviderResponse};
use super::redaction::redact_text;
use super::transport::sse::{parse_sse_line, SseParseOutcome};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
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

    let client = reqwest::Client::builder()
        .connect_timeout(PROVIDER_CONNECT_TIMEOUT)
        .timeout(PROVIDER_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    let response = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": build_chat_messages(request.messages),
            "temperature": 0.2,
        }))
        .send()
        .await
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    ensure_success_status(status, &body)?;

    let parsed = serde_json::from_str::<ChatCompletionResponse>(&body)
        .map_err(|error| errors::error("AI_RESPONSE_INVALID", error.to_string()))?;

    let content = parsed
        .choices
        .into_iter()
        .find_map(|choice| choice.message.content)
        .unwrap_or_default()
        .trim()
        .to_string();

    if content.is_empty() {
        return Err(errors::error(
            "AI_RESPONSE_INVALID",
            "AI Provider 未返回有效内容。",
        ));
    }

    Ok(AiProviderResponse {
        content,
        model: model.to_string(),
    })
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
        .build()
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    let mut response = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": build_chat_messages(request.messages),
            "temperature": 0.2,
            "stream": true,
        }))
        .send()
        .await
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

    let status = response.status();

    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?;

        return ensure_success_status(status, &body);
    }

    let mut buffer = String::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| errors::error("AI_PROVIDER_UNAVAILABLE", error.to_string()))?
    {
        if is_cancelled() {
            return Err(errors::error("AI_REQUEST_CANCELLED", "AI 请求已取消。"));
        }

        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim_end_matches('\r').to_string();
            buffer = buffer[line_end + 1..].to_string();

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

    if !buffer.trim().is_empty() {
        let should_finish = handle_sse_line(&buffer, &mut on_delta)?;

        if should_finish {
            return Ok(());
        }
    }

    Ok(())
}

pub async fn test(base_url: &str, api_key: &str, model: &str) -> Result<(), String> {
    let request = AiProviderChatRequest {
        messages: vec![AiProviderMessage {
            role: "user".to_string(),
            content: "ping".to_string(),
        }],
    };

    chat(base_url, api_key, model, request).await.map(|_| ())
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
    use super::{summarize_body, validate_base_url};

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
}
