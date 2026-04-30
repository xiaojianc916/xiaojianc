use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ai::errors;
use crate::ai::provider::{AiProviderToolCall, AiProviderToolSpec};
use crate::ai_tools::registry;
use crate::commands::contracts::{
    AiAgentToolInputsPayload, AiApplyPatchRequest, AiCreateCommitToolInputPayload,
    AiProposePatchRequest, AiRunCommandToolInputPayload, AiStageFileToolInputPayload,
    AiTaskPlanReferencePayload, AiTaskPlanStepPayload, AiWebFetchInput, AiWebSearchInput,
};

const MAX_PROVIDER_TOOL_CALLS_PER_TURN: usize = 8;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

pub fn normalize_provider_tool_calls(
    calls: Vec<AiProviderToolCall>,
) -> Result<Vec<AgentToolCall>, String> {
    if calls.len() > MAX_PROVIDER_TOOL_CALLS_PER_TURN {
        return Err(errors::error(
            "AI_AGENT_PLAN_TOO_LONG",
            "Provider returned too many tool calls in one turn.",
        ));
    }

    calls
        .into_iter()
        .map(|call| {
            let id = call.id.trim();
            let name = call.name.trim();

            if id.is_empty() || name.is_empty() {
                return Err(errors::error(
                    "AI_AGENT_TOOL_NOT_ALLOWED",
                    "Provider returned a tool call with empty id or name.",
                ));
            }
            if !registry::is_tool_registered(name) {
                return Err(errors::error(
                    "AI_AGENT_TOOL_NOT_ALLOWED",
                    "Provider returned an unregistered tool call.",
                ));
            }
            let arguments = if call.arguments.is_null() {
                Value::Object(serde_json::Map::new())
            } else if call.arguments.is_object() {
                call.arguments
            } else {
                return Err(errors::error(
                    "AI_AGENT_PLAN_INVALID",
                    "Provider tool call arguments must be a JSON object.",
                ));
            };

            Ok(AgentToolCall {
                id: id.to_string(),
                name: name.to_string(),
                arguments,
            })
        })
        .collect()
}

pub fn tool_call_to_plan_step(
    call: AgentToolCall,
    index: usize,
) -> Result<AiTaskPlanStepPayload, String> {
    let tool_inputs = tool_call_inputs(&call)?;
    let title = tool_call_step_title(&call);
    let goal = tool_call_step_goal(&call);
    let references = tool_call_references(&call);
    let risk_level = if registry::requires_confirmation(&call.name) {
        "medium"
    } else {
        "low"
    };

    let requires_user_approval = registry::requires_confirmation(&call.name);

    Ok(AiTaskPlanStepPayload {
        id: format!(
            "tool-call-step:{}:{}",
            call.name,
            sanitize_step_id(&call.id)
        ),
        index,
        title,
        goal,
        kind: infer_step_kind(&call.name).to_string(),
        status: "pending".to_string(),
        expected_output: "结构化工具结果会以 ToolResultMessage 回灌给模型。".to_string(),
        tools: vec![call.name],
        tool_inputs,
        references,
        is_active: None,
        requires_user_approval,
        risk_level: risk_level.to_string(),
        rollback_strategy: None,
    })
}

pub fn agent_provider_tool_specs() -> Vec<AiProviderToolSpec> {
    registry::list_tools()
        .into_iter()
        .map(|tool| AiProviderToolSpec {
            name: tool.name.to_string(),
            description: provider_tool_description(tool.name).to_string(),
            parameters: provider_tool_parameters(tool.name),
        })
        .collect()
}

fn provider_tool_description(name: &str) -> &'static str {
    match name {
        "read_current_file" => "读取当前编辑器文件的已脱敏上下文引用。",
        "read_selected_text" => "读取当前选区的已脱敏上下文引用。",
        "search_files" => "按当前任务目标在工作区内搜索相关文件。",
        "search_text" => "按当前任务目标在工作区内搜索文本内容。",
        "search_symbols" => "按当前任务目标在工作区内搜索符号。",
        "get_diagnostics" => "读取 IDE 已收集的诊断信息。",
        "get_git_diff" => "读取当前工作区 Git diff 摘要。",
        "get_terminal_log" => "读取当前终端日志的尾部引用。",
        "web_search" => "在用户授权后搜索公网资料，优先用于官方文档、错误排查和版本信息。",
        "web_fetch" => "在用户授权后读取指定 http/https 网页正文，并以 ref 返回大文本。",
        "propose_patch" => "根据原文和目标内容生成结构化 patch， 不直接写盘。",
        "auto_apply_patch" => "在用户授权后通过 AED 应用结构化 patch，并保留回滚能力。",
        "run_test" => "在用户授权后运行项目中最小相关测试。",
        "run_command" => "在用户授权后执行 Level 2 范围内的项目命令。",
        "stage_file" => "在用户授权后 stage 指定 Git 文件。",
        "create_commit" => "在用户授权后创建本地 Git commit，不执行 push。",
        "get_project_tree" => "读取工作区项目结构摘要。",
        "read_file" => "按当前任务目标读取相关文件摘要。",
        "list_open_files" => "列出当前 IDE 打开的文件上下文引用。",
        "get_package_scripts" => "读取 package.json scripts 摘要。",
        "get_test_targets" => "推断当前项目可用的测试目标。",
        _ => "执行已注册的 IDE Agent 工具。",
    }
}

fn provider_tool_parameters(name: &str) -> Value {
    match name {
        "web_search" => json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["query", "intent", "maxResults"],
            "properties": {
                "query": { "type": "string", "minLength": 1, "description": "已脱敏、可展示给用户的搜索 query。不要包含本地完整代码片段或密钥。" },
                "intent": {
                    "type": "string",
                    "enum": ["official-docs", "api-reference", "error-debug", "best-practice", "release-notes", "general"]
                },
                "maxResults": { "type": "integer", "minimum": 1, "maximum": 8 },
                "recency": { "type": "string", "enum": ["any", "day", "week", "month", "year"] }
            }
        }),
        "web_fetch" => json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["url", "reason", "maxBytes"],
            "properties": {
                "url": { "type": "string", "minLength": 1, "description": "仅允许 http/https 公网 URL；不要使用 localhost、内网 IP 或 file URL。" },
                "reason": { "type": "string", "minLength": 1 },
                "maxBytes": { "type": "integer", "minimum": 1, "maximum": 524288 }
            }
        }),
        "propose_patch" => json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["path", "originalContent", "updatedContent", "summary"],
            "properties": {
                "path": { "type": "string", "minLength": 1 },
                "originalContent": { "type": "string" },
                "updatedContent": { "type": "string" },
                "summary": { "type": "string", "minLength": 1 }
            }
        }),
        "auto_apply_patch" => json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["patch"],
            "properties": {
                "patch": {
                    "type": "object",
                    "additionalProperties": true,
                    "description": "必须是 propose_patch 返回或同等结构的 patch set；工具侧会再次 schema validate。"
                },
                "metadata": {
                    "type": "object",
                    "additionalProperties": true,
                    "description": "可选 AED 元数据；工具侧会补齐 agent run/step 信息。"
                }
            }
        }),
        "run_command" => json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["command", "reason", "cwdPolicy"],
            "properties": {
                "command": { "type": "string", "minLength": 1, "description": "只允许 Level 2 范围内命令；破坏性命令会被阻断或要求确认。" },
                "reason": { "type": "string", "minLength": 1 },
                "cwdPolicy": { "type": "string", "enum": ["workspace-root"] },
                "timeoutMs": { "type": "integer", "minimum": 1000, "maximum": 120000 }
            }
        }),
        "stage_file" => json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["paths", "reason"],
            "properties": {
                "paths": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
                "reason": { "type": "string", "minLength": 1 }
            }
        }),
        "create_commit" => json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["message", "reason"],
            "properties": {
                "message": { "type": "string", "minLength": 1 },
                "reason": { "type": "string", "minLength": 1 },
                "allowEmpty": { "type": "boolean" }
            }
        }),
        "search_files" | "search_text" | "search_symbols" => json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "query": { "type": "string", "minLength": 1, "description": "已脱敏的搜索关键词。" },
                "pattern": { "type": "string", "minLength": 1, "description": "可选，等同于 query。" },
                "term": { "type": "string", "minLength": 1, "description": "可选，等同于 query。" },
                "reason": { "type": "string", "minLength": 1 }
            }
        }),
        "read_file" => json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "path": { "type": "string", "minLength": 1, "description": "工作区内相对路径；工具侧会再次做 workspace 边界校验。" },
                "filePath": { "type": "string", "minLength": 1, "description": "可选，等同于 path。" },
                "uri": { "type": "string", "minLength": 1, "description": "可选，等同于 path。" },
                "reason": { "type": "string", "minLength": 1 }
            }
        }),
        "read_current_file"
        | "read_selected_text"
        | "get_diagnostics"
        | "get_git_diff"
        | "get_terminal_log"
        | "run_test"
        | "get_project_tree"
        | "list_open_files"
        | "get_package_scripts"
        | "get_test_targets" => json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "reason": { "type": "string", "minLength": 1 }
            }
        }),
        _ => json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {}
        }),
    }
}

fn tool_call_inputs(call: &AgentToolCall) -> Result<Option<AiAgentToolInputsPayload>, String> {
    match call.name.as_str() {
        "web_search" => Ok(Some(inputs_with_web_search(parse_arguments::<
            AiWebSearchInput,
        >(call)?))),
        "web_fetch" => Ok(Some(inputs_with_web_fetch(parse_arguments::<
            AiWebFetchInput,
        >(call)?))),
        "propose_patch" => Ok(Some(inputs_with_propose_patch(parse_arguments::<
            AiProposePatchRequest,
        >(call)?))),
        "auto_apply_patch" => Ok(Some(inputs_with_auto_apply_patch(parse_arguments::<
            AiApplyPatchRequest,
        >(call)?))),
        "run_command" => Ok(Some(inputs_with_run_command(parse_arguments::<
            AiRunCommandToolInputPayload,
        >(call)?))),
        "stage_file" => Ok(Some(inputs_with_stage_file(parse_arguments::<
            AiStageFileToolInputPayload,
        >(call)?))),
        "create_commit" => Ok(Some(inputs_with_create_commit(parse_arguments::<
            AiCreateCommitToolInputPayload,
        >(call)?))),
        "read_current_file"
        | "read_selected_text"
        | "search_files"
        | "search_text"
        | "search_symbols"
        | "get_diagnostics"
        | "get_git_diff"
        | "get_terminal_log"
        | "run_test"
        | "get_project_tree"
        | "read_file"
        | "list_open_files"
        | "get_package_scripts"
        | "get_test_targets" => {
            accept_ignored_arguments(call)?;
            Ok(None)
        }
        _ => Err(errors::error(
            "AI_AGENT_TOOL_NOT_ALLOWED",
            "Tool call references an unsupported tool.",
        )),
    }
}

fn tool_call_step_title(call: &AgentToolCall) -> String {
    if let Some(query) = search_query_argument(call) {
        return query;
    }

    if let Some(path) = file_path_argument(call) {
        return format!("读取文件 {path}");
    }

    format!("执行工具 {}", call.name)
}

fn tool_call_step_goal(call: &AgentToolCall) -> String {
    if let Some(query) = search_query_argument(call) {
        return format!("使用模型提供的已脱敏关键词执行 {}：{query}", call.name);
    }

    if let Some(path) = file_path_argument(call) {
        return format!("读取工作区内文件摘要：{path}");
    }

    format!("执行模型请求的工具调用 {}", call.name)
}

fn tool_call_references(call: &AgentToolCall) -> Option<Vec<AiTaskPlanReferencePayload>> {
    file_path_argument(call).map(|path| {
        vec![AiTaskPlanReferencePayload {
            r#type: "file".to_string(),
            label: path.clone(),
            uri: path,
        }]
    })
}

fn search_query_argument(call: &AgentToolCall) -> Option<String> {
    if !matches!(
        call.name.as_str(),
        "search_files" | "search_text" | "search_symbols"
    ) {
        return None;
    }

    optional_string_argument(call, &["query", "pattern", "term"])
}

fn file_path_argument(call: &AgentToolCall) -> Option<String> {
    if call.name != "read_file" {
        return None;
    }

    optional_string_argument(call, &["path", "filePath", "uri"])
}

fn optional_string_argument(call: &AgentToolCall, keys: &[&str]) -> Option<String> {
    let object = call.arguments.as_object()?;

    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .map(sanitize_provider_hint)
            .filter(|value| !value.is_empty())
    })
}

fn sanitize_provider_hint(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect::<String>()
        .trim()
        .to_string()
}

fn accept_ignored_arguments(call: &AgentToolCall) -> Result<(), String> {
    if call.arguments.is_object() {
        return Ok(());
    }

    Err(errors::error(
        "AI_AGENT_PLAN_INVALID",
        format!("Tool call `{}` arguments must be a JSON object.", call.name),
    ))
}

fn parse_arguments<T>(call: &AgentToolCall) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value::<T>(call.arguments.clone()).map_err(|error| {
        errors::error(
            "AI_AGENT_PLAN_INVALID",
            format!(
                "Tool call `{}` arguments failed schema validation: {error}",
                call.name
            ),
        )
    })
}

fn empty_inputs() -> AiAgentToolInputsPayload {
    AiAgentToolInputsPayload {
        web_search: None,
        web_fetch: None,
        propose_patch: None,
        auto_apply_patch: None,
        run_command: None,
        stage_file: None,
        create_commit: None,
    }
}

fn inputs_with_web_search(input: AiWebSearchInput) -> AiAgentToolInputsPayload {
    AiAgentToolInputsPayload {
        web_search: Some(input),
        ..empty_inputs()
    }
}

fn inputs_with_web_fetch(input: AiWebFetchInput) -> AiAgentToolInputsPayload {
    AiAgentToolInputsPayload {
        web_fetch: Some(input),
        ..empty_inputs()
    }
}

fn inputs_with_propose_patch(input: AiProposePatchRequest) -> AiAgentToolInputsPayload {
    AiAgentToolInputsPayload {
        propose_patch: Some(input),
        ..empty_inputs()
    }
}

fn inputs_with_auto_apply_patch(input: AiApplyPatchRequest) -> AiAgentToolInputsPayload {
    AiAgentToolInputsPayload {
        auto_apply_patch: Some(input),
        ..empty_inputs()
    }
}

fn inputs_with_run_command(input: AiRunCommandToolInputPayload) -> AiAgentToolInputsPayload {
    AiAgentToolInputsPayload {
        run_command: Some(input),
        ..empty_inputs()
    }
}

fn inputs_with_stage_file(input: AiStageFileToolInputPayload) -> AiAgentToolInputsPayload {
    AiAgentToolInputsPayload {
        stage_file: Some(input),
        ..empty_inputs()
    }
}

fn inputs_with_create_commit(input: AiCreateCommitToolInputPayload) -> AiAgentToolInputsPayload {
    AiAgentToolInputsPayload {
        create_commit: Some(input),
        ..empty_inputs()
    }
}

fn infer_step_kind(tool_name: &str) -> &'static str {
    match tool_name {
        "web_search" | "web_fetch" => "search",
        "propose_patch" | "auto_apply_patch" => "edit",
        "run_test" | "run_command" => "verify",
        "create_commit" | "stage_file" => "summarize",
        _ => "inspect",
    }
}

fn sanitize_step_id(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() || item == '-' || item == '_' {
                item
            } else {
                '-'
            }
        })
        .collect::<String>();

    normalized.trim_matches('-').chars().take(80).collect()
}

#[cfg(test)]
mod tests {
    use super::{normalize_provider_tool_calls, tool_call_to_plan_step};
    use crate::ai::provider::AiProviderToolCall;
    use serde_json::json;

    #[test]
    fn accepts_registered_provider_tool_call() {
        let calls = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-1".to_string(),
            name: "search_text".to_string(),
            arguments: json!({ "query": "agent" }),
        }])
        .expect("registered tool call should normalize");

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "search_text");
        assert_eq!(calls[0].arguments["query"], "agent");
    }

    #[test]
    fn treats_null_provider_arguments_as_empty_object() {
        let call = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-null-args".to_string(),
            name: "get_project_tree".to_string(),
            arguments: serde_json::Value::Null,
        }])
        .expect("null arguments should normalize to empty object")
        .remove(0);

        assert!(call
            .arguments
            .as_object()
            .is_some_and(|items| items.is_empty()));
    }

    #[test]
    fn rejects_unregistered_provider_tool_call() {
        let error = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-1".to_string(),
            name: "unknown_tool".to_string(),
            arguments: json!({}),
        }])
        .expect_err("unknown tool should fail");

        assert!(error.contains("AI_AGENT_TOOL_NOT_ALLOWED"));
    }

    #[test]
    fn rejects_too_many_provider_tool_calls() {
        let calls = (0..9)
            .map(|index| AiProviderToolCall {
                id: format!("call-{index}"),
                name: "run_test".to_string(),
                arguments: json!({}),
            })
            .collect::<Vec<_>>();

        let error = normalize_provider_tool_calls(calls).expect_err("too many calls should fail");

        assert!(error.contains("AI_AGENT_PLAN_TOO_LONG"));
    }

    #[test]
    fn converts_structured_web_search_tool_call_to_plan_step() {
        let call = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-1".to_string(),
            name: "web_search".to_string(),
            arguments: json!({
                "query": "Tauri capability docs",
                "intent": "official-docs",
                "maxResults": 3,
                "recency": "month"
            }),
        }])
        .expect("tool call should normalize")
        .remove(0);

        let step = tool_call_to_plan_step(call, 0).expect("step should convert");

        assert_eq!(step.tools, vec!["web_search"]);
        assert_eq!(step.kind, "search");
        assert!(step.requires_user_approval);
        let inputs = step.tool_inputs.expect("web search should have inputs");
        assert_eq!(
            inputs.web_search.expect("search input").query,
            "Tauri capability docs"
        );
    }

    #[test]
    fn converts_run_command_tool_call_to_plan_step() {
        let call = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-2".to_string(),
            name: "run_command".to_string(),
            arguments: json!({
                "command": "cargo test --help",
                "reason": "验证命令执行路径",
                "cwdPolicy": "workspace-root",
                "timeoutMs": 30000
            }),
        }])
        .expect("tool call should normalize")
        .remove(0);

        let step = tool_call_to_plan_step(call, 1).expect("step should convert");

        assert_eq!(step.tools, vec!["run_command"]);
        let inputs = step.tool_inputs.expect("run command should have inputs");
        assert_eq!(
            inputs.run_command.expect("command input").cwd_policy,
            "workspace-root"
        );
    }

    #[test]
    fn maps_provider_query_for_search_text() {
        let call = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-3".to_string(),
            name: "search_text".to_string(),
            arguments: json!({ "query": "agent" }),
        }])
        .expect("registered call should normalize")
        .remove(0);

        let step = tool_call_to_plan_step(call, 0).expect("query hint should be accepted");

        assert_eq!(step.title, "agent");
        assert_eq!(step.tools, vec!["search_text"]);
        assert!(step.tool_inputs.is_none());
    }

    #[test]
    fn accepts_provider_metadata_for_read_current_file() {
        let call = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-read-current".to_string(),
            name: "read_current_file".to_string(),
            arguments: json!({ "reason": "inspect current editor file" }),
        }])
        .expect("registered call should normalize")
        .remove(0);

        let step = tool_call_to_plan_step(call, 0).expect("metadata should be ignored safely");

        assert_eq!(step.tools, vec!["read_current_file"]);
        assert!(step.tool_inputs.is_none());
    }

    #[test]
    fn accepts_provider_metadata_for_get_project_tree() {
        let call = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-project-tree".to_string(),
            name: "get_project_tree".to_string(),
            arguments: json!({ "reason": "inspect project structure" }),
        }])
        .expect("registered call should normalize")
        .remove(0);

        let step = tool_call_to_plan_step(call, 0).expect("metadata should be ignored safely");

        assert_eq!(step.tools, vec!["get_project_tree"]);
        assert!(step.tool_inputs.is_none());
    }

    #[test]
    fn maps_provider_path_for_read_file() {
        let call = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-read-file".to_string(),
            name: "read_file".to_string(),
            arguments: json!({ "path": "src/main.ts", "reason": "inspect entry" }),
        }])
        .expect("registered call should normalize")
        .remove(0);

        let step = tool_call_to_plan_step(call, 0).expect("path hint should be accepted");
        let references = step
            .references
            .expect("read_file path should become a reference");

        assert_eq!(step.title, "读取文件 src/main.ts");
        assert_eq!(references.len(), 1);
        assert_eq!(references[0].r#type, "file");
        assert_eq!(references[0].uri, "src/main.ts");
    }

    #[test]
    fn rejects_invalid_structured_tool_arguments() {
        let call = normalize_provider_tool_calls(vec![AiProviderToolCall {
            id: "call-invalid-command".to_string(),
            name: "run_command".to_string(),
            arguments: json!({ "reason": "missing command" }),
        }])
        .expect("registered call should normalize")
        .remove(0);

        let error = tool_call_to_plan_step(call, 0).expect_err("invalid schema should fail");

        assert!(error.contains("AI_AGENT_PLAN_INVALID"));
    }
}
