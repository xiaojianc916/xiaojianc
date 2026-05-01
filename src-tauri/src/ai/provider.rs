use serde::{Deserialize, Serialize};
use serde_json::Value;

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

    pub fn system(content: impl Into<String>) -> Self {
        Self::new("system", content)
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

#[cfg(test)]
mod tests {
    use super::{AiProviderChatRequest, AiProviderMessage};

    #[test]
    fn chat_request_detects_empty_content() {
        let request = AiProviderChatRequest::new(vec![
            AiProviderMessage::system("   "),
            AiProviderMessage::user("\n"),
        ]);

        assert!(request.is_empty());
    }
}
