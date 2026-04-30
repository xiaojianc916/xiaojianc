use serde::{Deserialize, Serialize};
use serde_json::Value;

const MOCK_PROVIDER_MODEL: &str = "mock-ide-assistant";
const MOCK_PREVIEW_MAX_CHARS: usize = 180;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderMessage {
    pub role: String,
    pub content: String,
}

impl AiProviderMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::new("user", content)
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::new("assistant", content)
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self::new("system", content)
    }

    pub fn is_user(&self) -> bool {
        self.role == "user"
    }

    pub fn is_empty(&self) -> bool {
        self.content.trim().is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderChatRequest {
    pub messages: Vec<AiProviderMessage>,
    #[serde(default)]
    pub tools: Vec<AiProviderToolSpec>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub force_tool_choice_none: bool,
}

impl AiProviderChatRequest {
    pub fn new(messages: Vec<AiProviderMessage>) -> Self {
        Self {
            messages,
            tools: Vec::new(),
            force_tool_choice_none: false,
        }
    }

    pub fn single_user(content: impl Into<String>) -> Self {
        Self {
            messages: vec![AiProviderMessage::user(content)],
            tools: Vec::new(),
            force_tool_choice_none: false,
        }
    }

    pub fn with_tools(mut self, tools: Vec<AiProviderToolSpec>) -> Self {
        self.tools = tools;
        self.force_tool_choice_none = false;
        self
    }

    pub fn with_tool_choice_none(mut self) -> Self {
        self.tools.clear();
        self.force_tool_choice_none = true;
        self
    }

    pub fn is_empty(&self) -> bool {
        self.messages.iter().all(AiProviderMessage::is_empty)
    }

    pub fn last_user_message(&self) -> Option<&AiProviderMessage> {
        self.messages.iter().rev().find(|message| message.is_user())
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderResponse {
    pub content: String,
    pub model: String,
    pub tool_calls: Vec<AiProviderToolCall>,
}

impl AiProviderResponse {
    pub fn new(content: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            model: model.into(),
            tool_calls: Vec::new(),
        }
    }

    pub fn with_tool_calls(
        content: impl Into<String>,
        model: impl Into<String>,
        tool_calls: Vec<AiProviderToolCall>,
    ) -> Self {
        Self {
            content: content.into(),
            model: model.into(),
            tool_calls,
        }
    }
}

pub struct MockProvider;

impl MockProvider {
    pub fn chat(request: AiProviderChatRequest) -> AiProviderResponse {
        let last_user = request
            .last_user_message()
            .map(|message| message.content.trim())
            .filter(|content| !content.is_empty())
            .unwrap_or("未提供问题");

        let preview = clip_chars(last_user, MOCK_PREVIEW_MAX_CHARS);

        AiProviderResponse::new(
            format!(
                "MockProvider 已收到请求。\n\n当前仅启用通用 IDE AI 架构基线，不会调用真实模型。\n\n问题预览：{}",
                preview
            ),
            MOCK_PROVIDER_MODEL,
        )
    }
}

fn clip_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();

    let clipped: String = chars.by_ref().take(max_chars).collect();

    if chars.next().is_some() {
        format!("{clipped}…")
    } else {
        clipped
    }
}

#[cfg(test)]
mod tests {
    use super::{AiProviderChatRequest, AiProviderMessage, MockProvider, MOCK_PROVIDER_MODEL};

    #[test]
    fn mock_provider_uses_last_user_message() {
        let response = MockProvider::chat(AiProviderChatRequest::new(vec![
            AiProviderMessage::user("first"),
            AiProviderMessage::assistant("assistant response"),
            AiProviderMessage::user("second"),
        ]));

        assert!(response.content.contains("second"));
        assert!(!response.content.contains("first"));
        assert_eq!(response.model, MOCK_PROVIDER_MODEL);
    }

    #[test]
    fn mock_provider_handles_empty_request() {
        let response = MockProvider::chat(AiProviderChatRequest::new(Vec::new()));

        assert!(response.content.contains("未提供问题"));
        assert_eq!(response.model, MOCK_PROVIDER_MODEL);
    }

    #[test]
    fn mock_provider_clips_long_preview() {
        let long_prompt = "a".repeat(300);
        let response = MockProvider::chat(AiProviderChatRequest::single_user(long_prompt));

        assert!(response.content.contains('…'));
        assert!(response.content.chars().count() < 300);
    }

    #[test]
    fn chat_request_detects_empty_content() {
        let request = AiProviderChatRequest::new(vec![
            AiProviderMessage::system("   "),
            AiProviderMessage::user("\n"),
        ]);

        assert!(request.is_empty());
    }
}
