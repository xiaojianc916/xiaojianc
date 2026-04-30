use serde::Deserialize;

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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SseParseOutcome {
    Continue,
    Done,
}

pub fn parse_sse_line(line: &str) -> Result<(SseParseOutcome, Option<String>), String> {
    let trimmed = line.trim();

    if trimmed.is_empty() || trimmed.starts_with(':') {
        return Ok((SseParseOutcome::Continue, None));
    }

    let Some(data) = trimmed.strip_prefix("data:") else {
        return Ok((SseParseOutcome::Continue, None));
    };

    let payload = data.trim();

    if payload.is_empty() {
        return Ok((SseParseOutcome::Continue, None));
    }

    if payload == "[DONE]" {
        return Ok((SseParseOutcome::Done, None));
    }

    let parsed = serde_json::from_str::<ChatCompletionStreamChunk>(payload)
        .map_err(|error| format!("AI stream chunk 解析失败：{error}"))?;

    let delta = parsed
        .choices
        .into_iter()
        .filter_map(|choice| choice.delta)
        .filter_map(|delta| delta.content)
        .collect::<String>();

    if delta.is_empty() {
        return Ok((SseParseOutcome::Continue, None));
    }

    Ok((SseParseOutcome::Continue, Some(delta)))
}

#[cfg(test)]
mod tests {
    use super::{parse_sse_line, SseParseOutcome};

    #[test]
    fn parses_openai_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"hello"}}]}"#;

        let (outcome, delta) = parse_sse_line(line).expect("parse sse");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert_eq!(delta.as_deref(), Some("hello"));
    }

    #[test]
    fn parses_done_marker() {
        let (outcome, delta) = parse_sse_line("data: [DONE]").expect("parse done");

        assert_eq!(outcome, SseParseOutcome::Done);
        assert!(delta.is_none());
    }

    #[test]
    fn ignores_empty_lines() {
        let (outcome, delta) = parse_sse_line("").expect("parse empty line");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert!(delta.is_none());
    }

    #[test]
    fn ignores_comment_lines() {
        let (outcome, delta) = parse_sse_line(": keep-alive").expect("parse comment line");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert!(delta.is_none());
    }

    #[test]
    fn ignores_non_data_lines() {
        let (outcome, delta) = parse_sse_line("event: message").expect("parse event line");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert!(delta.is_none());
    }

    #[test]
    fn ignores_empty_data_payload() {
        let (outcome, delta) = parse_sse_line("data: ").expect("parse empty data payload");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert!(delta.is_none());
    }

    #[test]
    fn parses_data_without_space_after_colon() {
        let line = r#"data:{"choices":[{"delta":{"content":"hello"}}]}"#;

        let (outcome, delta) = parse_sse_line(line).expect("parse compact data line");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert_eq!(delta.as_deref(), Some("hello"));
    }

    #[test]
    fn concatenates_multiple_choice_deltas() {
        let line =
            r#"data: {"choices":[{"delta":{"content":"hello"}},{"delta":{"content":" world"}}]}"#;

        let (outcome, delta) = parse_sse_line(line).expect("parse multiple choices");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert_eq!(delta.as_deref(), Some("hello world"));
    }

    #[test]
    fn ignores_role_only_delta() {
        let line = r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#;

        let (outcome, delta) = parse_sse_line(line).expect("parse role-only delta");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert!(delta.is_none());
    }

    #[test]
    fn ignores_null_delta() {
        let line = r#"data: {"choices":[{"delta":null}]}"#;

        let (outcome, delta) = parse_sse_line(line).expect("parse null delta");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert!(delta.is_none());
    }

    #[test]
    fn ignores_empty_choices() {
        let line = r#"data: {"choices":[]}"#;

        let (outcome, delta) = parse_sse_line(line).expect("parse empty choices");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert!(delta.is_none());
    }

    #[test]
    fn ignores_finish_reason_only_chunk() {
        let line = r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#;

        let (outcome, delta) = parse_sse_line(line).expect("parse finish chunk");

        assert_eq!(outcome, SseParseOutcome::Continue);
        assert!(delta.is_none());
    }

    #[test]
    fn returns_error_for_invalid_json_data() {
        let result = parse_sse_line("data: not-json");

        assert!(result.is_err());
    }
}
