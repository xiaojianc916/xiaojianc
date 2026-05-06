use std::{collections::HashSet, fs, path::PathBuf};

use super::*;

const MIN_SUGGESTION_POOL_SIZE: usize = 9;
const MAX_SUGGESTION_POOL_SIZE: usize = 90;
const MAX_SUGGESTION_CHARS: usize = 42;
const SUGGESTION_POOL_CACHE_FILE_NAME: &str = "ai-suggestion-pool.json";
const DEFAULT_SUGGESTION_TOPICS: &[&str] = &[
    "健康",
    "生活小知识",
    "科学",
    "文学",
    "历史",
    "艺术",
    "学习",
    "效率",
    "旅行",
    "饮食",
    "心理",
    "科技",
    "自然",
    "哲学",
    "沟通",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParsedSuggestionPoolObject {
    suggestions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum ParsedSuggestionPoolResponse {
    Object(ParsedSuggestionPoolObject),
    Array(Vec<String>),
}

pub async fn generate_suggestion_pool(
    payload: AiSuggestionPoolRequest,
) -> Result<AiSuggestionPoolPayload, String> {
    let config = current_config()?;
    let narrator_config = &config.narrator;
    let count = normalize_suggestion_count(payload.count);
    let locale = normalize_locale(&payload.locale);
    let topics = normalize_topics(&payload.topics);
    let model = narrator_config
        .selected_model
        .as_deref()
        .unwrap_or(DEFAULT_NARRATOR_MODEL);
    let base_url = resolve_model_endpoint_base_url(narrator_config)?;
    let api_key = get_api_key_for_model_endpoint(narrator_config, AiResolvedModelRole::Narrator)?;
    let request = AiProviderChatRequest::new(vec![
        conversation::build_identity_system_message(model),
        AiProviderMessage::system(build_suggestion_pool_system_prompt(count)),
        AiProviderMessage::user(build_suggestion_pool_user_prompt(&locale, &topics, count)),
    ]);
    let response =
        connection::chat_with_litellm_fallback(base_url, &api_key, model, request).await?;
    let suggestions = parse_suggestion_pool_response(&response.content, count);

    if suggestions.len() < count {
        return Err(errors::error(
            "AI_RESPONSE_INVALID",
            &format!("小模型生成的提示词池不足 {count} 条。"),
        ));
    }

    let payload = AiSuggestionPoolPayload {
        suggestions,
        model: response.model,
        generated_at: chrono::Utc::now().to_rfc3339(),
    };

    persist_suggestion_pool_cache(&payload)?;

    Ok(payload)
}

pub fn get_suggestion_pool_cache() -> Result<Option<AiSuggestionPoolPayload>, String> {
    let Some(path) = suggestion_pool_cache_path() else {
        return Ok(None);
    };
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(errors::error(
                "AI_PROVIDER_UNAVAILABLE",
                &format!("提示词池缓存读取失败：{error}"),
            ));
        }
    };
    let payload = match serde_json::from_str::<AiSuggestionPoolPayload>(&content) {
        Ok(payload) => payload,
        Err(_) => return Ok(None),
    };
    let suggestions = normalize_suggestion_pool(payload.suggestions, MAX_SUGGESTION_POOL_SIZE);

    if suggestions.len() < MIN_SUGGESTION_POOL_SIZE
        || payload.model.trim().is_empty()
        || payload.generated_at.trim().is_empty()
    {
        return Ok(None);
    }

    Ok(Some(AiSuggestionPoolPayload {
        suggestions,
        model: payload.model,
        generated_at: payload.generated_at,
    }))
}

fn normalize_suggestion_count(value: usize) -> usize {
    value.clamp(MIN_SUGGESTION_POOL_SIZE, MAX_SUGGESTION_POOL_SIZE)
}

fn normalize_locale(value: &str) -> String {
    let locale = value.trim();

    if locale.is_empty() {
        return "zh-CN".to_string();
    }

    locale.chars().take(16).collect()
}

fn normalize_topics(topics: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();

    for topic in topics {
        let normalized = topic.trim();

        if normalized.is_empty() || seen.contains(normalized) {
            continue;
        }

        seen.insert(normalized.to_string());
        result.push(normalized.chars().take(16).collect());
    }

    if result.is_empty() {
        return DEFAULT_SUGGESTION_TOPICS
            .iter()
            .map(|topic| (*topic).to_string())
            .collect();
    }

    result
}

fn build_suggestion_pool_system_prompt(count: usize) -> String {
    format!(
        "你是桌面 AI 助手首页的提示词策划器。\n\
目标是生成可以直接发送给 AI 的短提示词，不要只围绕编程。\n\
提示词要覆盖健康、生活小知识、科学、文学、历史、艺术、学习、效率、旅行、饮食、心理、科技、自然、哲学、沟通等领域。\n\
健康相关提示只能做一般生活建议，不能要求诊断、处方、治疗方案或替代医生意见。\n\
每条提示词必须是简体中文、自然口语、4 到 42 个字符，适合作为按钮文案。\n\
每个提示词都要求是具体一点的内容，拒接泛泛而谈 \n\
不要重复，不要编号，不要 Markdown，不要解释。\n\
只输出 JSON 对象：{{\"suggestions\":[恰好 {count} 条字符串]}}",
    )
}

fn build_suggestion_pool_user_prompt(locale: &str, topics: &[String], count: usize) -> String {
    let non_code_count = count.saturating_mul(2) / 3;

    format!(
        "请生成 {count} 个提示词。\n语言：{}\n覆盖领域：{}\n\n要求：\n- 领域要分散，不要连续出现同一主题\n- 每条都能作为用户点击后直接发送给 AI 的问题或任务\n- 语气轻巧，但不要卖萌\n- 至少 {non_code_count} 条不要涉及代码或开发\n- 严格返回 JSON",
        sanitize_fenced_text(locale),
        topics
            .iter()
            .map(|topic| sanitize_fenced_text(topic))
            .collect::<Vec<_>>()
            .join("、"),
    )
}

fn suggestion_pool_cache_path() -> Option<PathBuf> {
    Some(config_file_path()?.with_file_name(SUGGESTION_POOL_CACHE_FILE_NAME))
}

fn persist_suggestion_pool_cache(payload: &AiSuggestionPoolPayload) -> Result<(), String> {
    let Some(path) = suggestion_pool_cache_path() else {
        return Ok(());
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            errors::error(
                "AI_PROVIDER_UNAVAILABLE",
                &format!("提示词池缓存目录创建失败：{error}"),
            )
        })?;
    }

    let content = serde_json::to_string_pretty(payload).map_err(|error| {
        errors::error(
            "AI_RESPONSE_INVALID",
            &format!("提示词池缓存序列化失败：{error}"),
        )
    })?;
    let temp_path = path.with_extension("json.tmp");
    let backup_path = path.with_extension("json.bak");

    fs::write(&temp_path, content).map_err(|error| {
        errors::error(
            "AI_PROVIDER_UNAVAILABLE",
            &format!("提示词池缓存写入失败：{error}"),
        )
    })?;

    if backup_path.exists() {
        fs::remove_file(&backup_path).map_err(|error| {
            errors::error(
                "AI_PROVIDER_UNAVAILABLE",
                &format!("提示词池旧缓存备份清理失败：{error}"),
            )
        })?;
    }

    let had_existing_cache = path.exists();

    if had_existing_cache {
        fs::rename(&path, &backup_path).map_err(|error| {
            errors::error(
                "AI_PROVIDER_UNAVAILABLE",
                &format!("旧提示词池缓存备份失败：{error}"),
            )
        })?;
    }

    match fs::rename(&temp_path, &path) {
        Ok(()) => {
            if had_existing_cache && backup_path.exists() {
                fs::remove_file(&backup_path).map_err(|error| {
                    errors::error(
                        "AI_PROVIDER_UNAVAILABLE",
                        &format!("旧提示词池缓存删除失败：{error}"),
                    )
                })?;
            }

            Ok(())
        }
        Err(error) => {
            if had_existing_cache && backup_path.exists() {
                let _ = fs::rename(&backup_path, &path);
            }
            let _ = fs::remove_file(&temp_path);

            Err(errors::error(
                "AI_PROVIDER_UNAVAILABLE",
                &format!("提示词池缓存替换失败：{error}"),
            ))
        }
    }
}

pub(super) fn parse_suggestion_pool_response(value: &str, count: usize) -> Vec<String> {
    let requested_count = normalize_suggestion_count(count);
    let parsed = parse_suggestion_json(value).unwrap_or_else(|| parse_suggestion_lines(value));

    normalize_suggestion_pool(parsed, requested_count)
}

fn parse_suggestion_json(value: &str) -> Option<Vec<String>> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return None;
    }

    for candidate in json_candidates(trimmed) {
        let parsed = serde_json::from_str::<ParsedSuggestionPoolResponse>(candidate).ok();

        if let Some(parsed) = parsed {
            return Some(match parsed {
                ParsedSuggestionPoolResponse::Object(object) => object.suggestions,
                ParsedSuggestionPoolResponse::Array(items) => items,
            });
        }
    }

    None
}

fn json_candidates(value: &str) -> Vec<&str> {
    let mut result = Vec::new();

    if value.starts_with('{') || value.starts_with('[') {
        result.push(value);
    }

    if let (Some(start), Some(end)) = (value.find('{'), value.rfind('}')) {
        if start <= end {
            if let Some(slice) = value.get(start..=end) {
                result.push(slice);
            }
        }
    }

    if let (Some(start), Some(end)) = (value.find('['), value.rfind(']')) {
        if start <= end {
            if let Some(slice) = value.get(start..=end) {
                result.push(slice);
            }
        }
    }

    result
}

fn parse_suggestion_lines(value: &str) -> Vec<String> {
    value
        .lines()
        .filter_map(normalize_suggestion_text)
        .collect()
}

fn normalize_suggestion_pool(suggestions: Vec<String>, count: usize) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();

    for suggestion in suggestions {
        let Some(normalized) = normalize_suggestion_text(&suggestion) else {
            continue;
        };
        let key = normalized.to_lowercase();

        if seen.contains(&key) {
            continue;
        }

        seen.insert(key);
        result.push(normalized);

        if result.len() >= count {
            break;
        }
    }

    result
}

pub(super) fn normalize_suggestion_text(value: &str) -> Option<String> {
    let without_marker = strip_leading_list_marker(value);
    let collapsed = without_marker
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = collapsed.trim_matches(|item: char| {
        item.is_whitespace()
            || matches!(
                item,
                '"' | '\''
                    | '“'
                    | '”'
                    | '‘'
                    | '’'
                    | '《'
                    | '》'
                    | '【'
                    | '】'
                    | '「'
                    | '」'
                    | '『'
                    | '』'
                    | '。'
                    | '，'
                    | ','
                    | '.'
                    | ':'
                    | '：'
                    | ';'
                    | '；'
            )
    });
    let char_count = trimmed.chars().count();

    if !(4..=MAX_SUGGESTION_CHARS).contains(&char_count) {
        return None;
    }

    Some(trimmed.chars().take(MAX_SUGGESTION_CHARS).collect())
}

fn strip_leading_list_marker(value: &str) -> &str {
    let mut text = value
        .trim()
        .trim_start_matches(|item: char| matches!(item, '-' | '*' | '•' | '·'))
        .trim_start();

    let mut digit_end = 0;
    let mut has_digit = false;

    for (index, item) in text.char_indices() {
        if item.is_ascii_digit() {
            has_digit = true;
            digit_end = index + item.len_utf8();
            continue;
        }

        if has_digit && matches!(item, '.' | '、' | ')' | '）') {
            digit_end = index + item.len_utf8();
            break;
        }

        digit_end = 0;
        break;
    }

    if digit_end > 0 {
        text = text.get(digit_end..).unwrap_or(text).trim_start();
    }

    text
}
