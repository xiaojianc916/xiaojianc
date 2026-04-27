use super::contracts::{AiChatPayload, AiChatRequest};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

const AI_CHAT_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_AI_MESSAGES: usize = 32;
const MAX_MESSAGE_CHARS: usize = 16_000;

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
    content: String,
}

#[tauri::command]
pub async fn send_ai_chat(payload: AiChatRequest) -> Result<AiChatPayload, String> {
    let endpoint = payload.endpoint.trim().trim_end_matches('/');
    let api_key = payload.api_key.trim();
    let model = payload.model.trim();

    if endpoint.is_empty() {
        return Err("请填写 AI 服务 API 地址。".into());
    }
    if !(endpoint.starts_with("https://") || endpoint.starts_with("http://localhost")) {
        return Err("AI 服务地址必须使用 HTTPS；本地调试仅允许 http://localhost。".into());
    }
    if api_key.is_empty() {
        return Err("请填写 AI 服务 API Key。".into());
    }
    if model.is_empty() {
        return Err("请填写模型名称。".into());
    }
    if payload.messages.is_empty() {
        return Err("请输入要发送给 AI 的内容。".into());
    }
    if payload.messages.len() > MAX_AI_MESSAGES {
        return Err("对话轮次过多，请清空部分历史后重试。".into());
    }

    let mut messages = Vec::new();
    let system_prompt = payload.system_prompt.trim();
    if !system_prompt.is_empty() {
        messages.push(json!({
            "role": "system",
            "content": clamp_message(system_prompt),
        }));
    }

    for message in payload.messages {
        let role = normalize_role(&message.role)?;
        let content = clamp_message(&message.content);
        if content.trim().is_empty() {
            continue;
        }

        messages.push(json!({
            "role": role,
            "content": content,
        }));
    }

    if messages.is_empty() {
        return Err("请输入要发送给 AI 的内容。".into());
    }

    let client = reqwest::Client::builder()
        .timeout(AI_CHAT_TIMEOUT)
        .build()
        .map_err(|error| format!("初始化 AI HTTP 客户端失败：{error}"))?;
    let url = format!("{endpoint}/chat/completions");
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": messages,
            "temperature": 0.2,
        }))
        .send()
        .await
        .map_err(|error| format!("AI 请求失败：{error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取 AI 响应失败：{error}"))?;

    if !status.is_success() {
        return Err(format!(
            "AI 服务返回错误 {status}：{}",
            summarize_body(&body)
        ));
    }

    let parsed = serde_json::from_str::<ChatCompletionResponse>(&body)
        .map_err(|error| format!("解析 AI 响应失败：{error}"))?;
    let content = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .unwrap_or_default()
        .trim()
        .to_string();

    if content.is_empty() {
        return Err("AI 服务未返回有效内容。".into());
    }

    Ok(AiChatPayload {
        content,
        model: model.into(),
    })
}

fn normalize_role(role: &str) -> Result<&'static str, String> {
    match role {
        "user" => Ok("user"),
        "assistant" => Ok("assistant"),
        "system" => Ok("system"),
        _ => Err("AI 消息角色不受支持。".into()),
    }
}

fn clamp_message(value: &str) -> String {
    value.chars().take(MAX_MESSAGE_CHARS).collect()
}

fn summarize_body(value: &str) -> String {
    value.chars().take(600).collect()
}
