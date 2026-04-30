use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::hash::{Hash, Hasher};
use std::mem;
use std::time::{Duration, Instant};

use crate::ai::errors;
use crate::ai::provider::{
    AiProviderChatRequest, AiProviderMessage, AiProviderResponse, AiProviderToolCall,
};
use crate::ai_agent::tool_call::agent_provider_tool_specs;
use crate::ai_agent::tool_loop::{
    execute_provider_tool_calls_with_services, load_tool_output_ref, AgentProviderToolUseRequest,
    AgentRunMessage, AgentToolResultMessage, AgentToolRuntimeServices,
};
use crate::commands::contracts::AiContextReferencePayload;

const DEFAULT_MAX_TOOL_TURNS: usize = 16;
const MAX_TOOL_TURNS_LIMIT: usize = 24;
const MAX_PROVIDER_TOOL_EXCERPT_CHARS: usize = 2_400;
const MAX_REPEATED_TOOL_NAME_CALLS: usize = 5;
const DEFAULT_MAX_RUNTIME: Duration = Duration::from_secs(45);

const STOP_REASON_COMPLETED: &str = "completed";
const STOP_REASON_TOOL_CONFIRMATION_REQUIRED: &str = "tool-confirmation-required";

#[derive(Debug, Clone)]
pub struct AgentProviderLoopRequest {
    pub run_id: String,
    pub messages: Vec<AiProviderMessage>,
    pub workspace_root: Option<String>,
    pub references: Vec<AiContextReferencePayload>,
    pub tool_decisions: HashMap<String, String>,
    pub max_tool_turns: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct AgentProviderLoopOutcome {
    pub final_response: AiProviderResponse,
    pub messages: Vec<AiProviderMessage>,
    pub run_messages: Vec<AgentRunMessage>,
    pub turns: usize,
    pub stop_reason: String,
}

/// Result of processing a single provider response inside the loop.
enum LoopStep {
    /// Provider produced no tool calls — terminate with `"completed"`.
    Completed(AgentProviderLoopOutcome),
    /// A tool result asked for user confirmation — pause the loop.
    AwaitingConfirmation(AgentProviderLoopOutcome),
    /// Runtime guard stopped tool use. The caller must ask the model once more
    /// with `tools=[]` so the user gets a useful final answer, not internals.
    ForceFinal {
        reason: FinalAnswerReason,
        model: String,
    },
    /// Tool execution succeeded — continue to the next provider turn.
    Continue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AgentTaskType {
    CurrentFileEdit,
    RepoAnalysis,
    General,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum FinalAnswerReason {
    ToolBudgetExceeded,
    DuplicateToolCall,
    ToolNotAllowed(String),
    NoNewInformation,
    ConsecutiveToolFailures,
    RuntimeTimeout,
}

#[derive(Debug, Clone)]
struct AgentToolPolicy {
    task_type: AgentTaskType,
    allowed_tools: &'static [&'static str],
    max_tool_turns: usize,
    max_repeated_tool_name_calls: usize,
    max_no_new_info_rounds: usize,
    max_consecutive_failure_rounds: usize,
    max_runtime: Duration,
}

#[derive(Debug, Default)]
struct LoopGuardState {
    last_tool_call_signatures: Option<Vec<String>>,
    signature_counts: HashMap<String, usize>,
    tool_name_counts: HashMap<String, usize>,
    observation_signatures: HashSet<String>,
    no_new_info_rounds: usize,
    consecutive_failure_rounds: usize,
    executed_tool_calls: usize,
}

/// Synchronous variant of the agent provider loop.
///
/// Drives `call_provider` up to `max_tool_turns` iterations, executing any
/// tool calls returned by the provider between turns. Returns early on
/// completion (no tool calls), confirmation-required tool results, or
/// cancellation.
pub fn run_agent_provider_loop<F>(
    request: AgentProviderLoopRequest,
    services: Option<&dyn AgentToolRuntimeServices>,
    mut call_provider: F,
    is_cancelled: impl Fn() -> bool,
) -> Result<AgentProviderLoopOutcome, String>
where
    F: FnMut(AiProviderChatRequest) -> Result<AiProviderResponse, String>,
{
    validate_loop_request(&request)?;
    let requested_max_tool_turns = resolve_max_tool_turns(request.max_tool_turns)?;

    let AgentProviderLoopRequest {
        run_id,
        messages,
        workspace_root,
        references,
        tool_decisions,
        ..
    } = request;

    let mut messages = messages;
    let mut run_messages: Vec<AgentRunMessage> = Vec::new();
    let mut guard_state = LoopGuardState::default();
    let policy = classify_task_policy(&messages, &references);
    let max_tool_turns = requested_max_tool_turns.min(policy.max_tool_turns);
    let started_at = Instant::now();

    for turn in 0..max_tool_turns {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        if started_at.elapsed() >= policy.max_runtime {
            return Ok(finalize_loop_with_no_tools(
                FinalAnswerReason::RuntimeTimeout,
                "mock",
                &mut call_provider,
                &mut messages,
                &mut run_messages,
                turn + 1,
            ));
        }

        let response = call_provider(
            AiProviderChatRequest::new(messages.clone())
                .with_tools(agent_provider_tool_specs_for_policy(&policy)),
        )?;

        match advance_loop(
            response,
            turn,
            max_tool_turns,
            &policy,
            &run_id,
            workspace_root.as_ref(),
            &references,
            &tool_decisions,
            services,
            &mut messages,
            &mut run_messages,
            &mut guard_state,
        )? {
            LoopStep::Completed(outcome) | LoopStep::AwaitingConfirmation(outcome) => {
                return Ok(outcome);
            }
            LoopStep::ForceFinal { reason, model } => {
                return Ok(finalize_loop_with_no_tools(
                    reason,
                    &model,
                    &mut call_provider,
                    &mut messages,
                    &mut run_messages,
                    turn + 1,
                ));
            }
            LoopStep::Continue => continue,
        }
    }

    Ok(finalize_loop_with_no_tools(
        FinalAnswerReason::ToolBudgetExceeded,
        "mock",
        &mut call_provider,
        &mut messages,
        &mut run_messages,
        max_tool_turns + 1,
    ))
}

/// Asynchronous variant of the agent provider loop. Behaviour is identical
/// to [`run_agent_provider_loop`] except that `call_provider` returns a
/// future that is awaited.
pub async fn run_agent_provider_loop_async<F, Fut>(
    request: AgentProviderLoopRequest,
    services: Option<&dyn AgentToolRuntimeServices>,
    mut call_provider: F,
    is_cancelled: impl Fn() -> bool,
) -> Result<AgentProviderLoopOutcome, String>
where
    F: FnMut(AiProviderChatRequest) -> Fut,
    Fut: Future<Output = Result<AiProviderResponse, String>>,
{
    validate_loop_request(&request)?;
    let requested_max_tool_turns = resolve_max_tool_turns(request.max_tool_turns)?;

    let AgentProviderLoopRequest {
        run_id,
        messages,
        workspace_root,
        references,
        tool_decisions,
        ..
    } = request;

    let mut messages = messages;
    let mut run_messages: Vec<AgentRunMessage> = Vec::new();
    let mut guard_state = LoopGuardState::default();
    let policy = classify_task_policy(&messages, &references);
    let max_tool_turns = requested_max_tool_turns.min(policy.max_tool_turns);
    let started_at = Instant::now();

    for turn in 0..max_tool_turns {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        if started_at.elapsed() >= policy.max_runtime {
            return Ok(finalize_loop_with_no_tools_async(
                FinalAnswerReason::RuntimeTimeout,
                "mock",
                &mut call_provider,
                &mut messages,
                &mut run_messages,
                turn + 1,
            )
            .await);
        }

        let response = call_provider(
            AiProviderChatRequest::new(messages.clone())
                .with_tools(agent_provider_tool_specs_for_policy(&policy)),
        )
        .await?;

        match advance_loop(
            response,
            turn,
            max_tool_turns,
            &policy,
            &run_id,
            workspace_root.as_ref(),
            &references,
            &tool_decisions,
            services,
            &mut messages,
            &mut run_messages,
            &mut guard_state,
        )? {
            LoopStep::Completed(outcome) | LoopStep::AwaitingConfirmation(outcome) => {
                return Ok(outcome);
            }
            LoopStep::ForceFinal { reason, model } => {
                return Ok(finalize_loop_with_no_tools_async(
                    reason,
                    &model,
                    &mut call_provider,
                    &mut messages,
                    &mut run_messages,
                    turn + 1,
                )
                .await);
            }
            LoopStep::Continue => continue,
        }
    }

    Ok(finalize_loop_with_no_tools_async(
        FinalAnswerReason::ToolBudgetExceeded,
        "mock",
        &mut call_provider,
        &mut messages,
        &mut run_messages,
        max_tool_turns + 1,
    )
    .await)
}

/// Process a single provider response: append the assistant message,
/// optionally execute tool calls, append their representations to the
/// running message buffers, and report whether the loop should stop.
#[allow(clippy::too_many_arguments)]
fn advance_loop(
    response: AiProviderResponse,
    turn: usize,
    max_tool_turns: usize,
    policy: &AgentToolPolicy,
    run_id: &str,
    workspace_root: Option<&String>,
    references: &[AiContextReferencePayload],
    tool_decisions: &HashMap<String, String>,
    services: Option<&dyn AgentToolRuntimeServices>,
    messages: &mut Vec<AiProviderMessage>,
    run_messages: &mut Vec<AgentRunMessage>,
    guard_state: &mut LoopGuardState,
) -> Result<LoopStep, String> {
    let tool_calls = response.tool_calls.clone();
    let has_tool_calls = !tool_calls.is_empty();
    let final_response = response.clone();

    messages.push(AiProviderMessage::assistant(response.content.clone()));

    if !has_tool_calls {
        return Ok(LoopStep::Completed(AgentProviderLoopOutcome {
            final_response,
            messages: mem::take(messages),
            run_messages: mem::take(run_messages),
            turns: turn + 1,
            stop_reason: STOP_REASON_COMPLETED.to_string(),
        }));
    }

    if let Some(tool_name) = first_disallowed_tool(policy, &tool_calls) {
        return Ok(LoopStep::ForceFinal {
            reason: FinalAnswerReason::ToolNotAllowed(tool_name),
            model: final_response.model,
        });
    }

    if guard_state.executed_tool_calls + tool_calls.len() > max_tool_turns {
        return Ok(LoopStep::ForceFinal {
            reason: FinalAnswerReason::ToolBudgetExceeded,
            model: final_response.model,
        });
    }

    let current_signatures = tool_call_signatures(&tool_calls)?;
    if guard_state
        .last_tool_call_signatures
        .as_ref()
        .is_some_and(|previous| previous == &current_signatures)
        || has_seen_tool_call_signature(guard_state, &current_signatures)
    {
        return Ok(LoopStep::ForceFinal {
            reason: FinalAnswerReason::DuplicateToolCall,
            model: final_response.model,
        });
    }
    if has_exceeded_tool_name_budget(guard_state, &tool_calls, policy) {
        return Ok(LoopStep::ForceFinal {
            reason: FinalAnswerReason::ToolBudgetExceeded,
            model: final_response.model,
        });
    }
    record_tool_calls(guard_state, &current_signatures, &tool_calls);

    let tool_messages = execute_provider_tool_calls_with_services(
        AgentProviderToolUseRequest {
            run_id: run_id.to_string(),
            workspace_root: workspace_root.cloned(),
            references: references.to_vec(),
            tool_decisions: tool_decisions.clone(),
        },
        tool_calls,
        services,
    )?;

    let requires_confirmation = tool_messages
        .iter()
        .filter_map(tool_result_message)
        .any(|message| message.requires_user_confirmation);
    let final_guard_after_observation =
        update_observation_guards(guard_state, &tool_messages, policy);

    messages.extend(
        tool_messages
            .iter()
            .flat_map(provider_messages_from_tool_message),
    );
    messages.push(AiProviderMessage::system(
        "Tool execution round completed. Prefer a final answer if the current tool results are sufficient. Only call another tool when you still need different information or a write action to finish the task.".to_string(),
    ));
    run_messages.extend(tool_messages);

    if requires_confirmation {
        return Ok(LoopStep::AwaitingConfirmation(AgentProviderLoopOutcome {
            final_response,
            messages: mem::take(messages),
            run_messages: mem::take(run_messages),
            turns: turn + 1,
            stop_reason: STOP_REASON_TOOL_CONFIRMATION_REQUIRED.to_string(),
        }));
    }

    if let Some(reason) = final_guard_after_observation {
        return Ok(LoopStep::ForceFinal {
            reason,
            model: final_response.model,
        });
    }

    Ok(LoopStep::Continue)
}

fn resolve_max_tool_turns(requested: Option<usize>) -> Result<usize, String> {
    let max_tool_turns = requested.unwrap_or(DEFAULT_MAX_TOOL_TURNS);
    if max_tool_turns == 0 || max_tool_turns > MAX_TOOL_TURNS_LIMIT {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "Agent provider loop maxToolTurns is outside the allowed range.",
        ));
    }
    Ok(max_tool_turns)
}

fn classify_task_policy(
    messages: &[AiProviderMessage],
    references: &[AiContextReferencePayload],
) -> AgentToolPolicy {
    let last_user = messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.to_lowercase())
        .unwrap_or_default();
    let has_current_file = references
        .iter()
        .any(|reference| reference.kind == "current-file");
    let looks_like_edit = [
        "修改", "丰富", "完善", "优化", "补全", "改造", "重构", "edit", "update", "improve",
        "enhance", "rewrite",
    ]
    .iter()
    .any(|keyword| last_user.contains(keyword));

    if has_current_file && looks_like_edit {
        return AgentToolPolicy {
            task_type: AgentTaskType::CurrentFileEdit,
            allowed_tools: &[
                "read_current_file",
                "read_file",
                "propose_patch",
                "auto_apply_patch",
            ],
            max_tool_turns: 4,
            max_repeated_tool_name_calls: 1,
            max_no_new_info_rounds: 1,
            max_consecutive_failure_rounds: 1,
            max_runtime: Duration::from_secs(20),
        };
    }

    if last_user.contains("项目")
        || last_user.contains("代码库")
        || last_user.contains("全仓")
        || last_user.contains("repo")
        || last_user.contains("project")
    {
        return AgentToolPolicy {
            task_type: AgentTaskType::RepoAnalysis,
            allowed_tools: &[
                "get_project_tree",
                "read_file",
                "search_files",
                "search_text",
                "search_symbols",
                "get_git_diff",
                "get_diagnostics",
            ],
            max_tool_turns: 12,
            max_repeated_tool_name_calls: MAX_REPEATED_TOOL_NAME_CALLS,
            max_no_new_info_rounds: 2,
            max_consecutive_failure_rounds: 2,
            max_runtime: DEFAULT_MAX_RUNTIME,
        };
    }

    AgentToolPolicy {
        task_type: AgentTaskType::General,
        allowed_tools: &[
            "read_current_file",
            "read_selected_text",
            "search_files",
            "search_text",
            "search_symbols",
            "get_diagnostics",
            "get_git_diff",
            "get_terminal_log",
            "web_search",
            "web_fetch",
            "propose_patch",
            "auto_apply_patch",
            "run_test",
            "run_command",
            "stage_file",
            "create_commit",
            "get_project_tree",
            "read_file",
            "list_open_files",
            "get_package_scripts",
            "get_test_targets",
        ],
        max_tool_turns: DEFAULT_MAX_TOOL_TURNS,
        max_repeated_tool_name_calls: MAX_REPEATED_TOOL_NAME_CALLS,
        max_no_new_info_rounds: 2,
        max_consecutive_failure_rounds: 2,
        max_runtime: DEFAULT_MAX_RUNTIME,
    }
}

fn agent_provider_tool_specs_for_policy(
    policy: &AgentToolPolicy,
) -> Vec<crate::ai::provider::AiProviderToolSpec> {
    agent_provider_tool_specs()
        .into_iter()
        .filter(|tool| policy.allowed_tools.contains(&tool.name.as_str()))
        .collect()
}

fn first_disallowed_tool(
    policy: &AgentToolPolicy,
    tool_calls: &[AiProviderToolCall],
) -> Option<String> {
    tool_calls
        .iter()
        .find(|call| !policy.allowed_tools.contains(&call.name.as_str()))
        .map(|call| call.name.clone())
}

fn has_seen_tool_call_signature(state: &LoopGuardState, signatures: &[String]) -> bool {
    signatures
        .iter()
        .any(|signature| state.signature_counts.get(signature).copied().unwrap_or(0) > 0)
}

fn has_exceeded_tool_name_budget(
    state: &LoopGuardState,
    tool_calls: &[AiProviderToolCall],
    policy: &AgentToolPolicy,
) -> bool {
    tool_calls.iter().any(|call| {
        state.tool_name_counts.get(&call.name).copied().unwrap_or(0)
            >= policy.max_repeated_tool_name_calls
    })
}

fn record_tool_calls(
    state: &mut LoopGuardState,
    signatures: &[String],
    tool_calls: &[AiProviderToolCall],
) {
    state.last_tool_call_signatures = Some(signatures.to_vec());

    for signature in signatures {
        *state.signature_counts.entry(signature.clone()).or_insert(0) += 1;
    }

    for call in tool_calls {
        *state.tool_name_counts.entry(call.name.clone()).or_insert(0) += 1;
    }
}

fn update_observation_guards(
    state: &mut LoopGuardState,
    tool_messages: &[AgentRunMessage],
    policy: &AgentToolPolicy,
) -> Option<FinalAnswerReason> {
    let results = tool_messages
        .iter()
        .filter_map(tool_result_message)
        .collect::<Vec<_>>();

    state.executed_tool_calls += results.len();

    if !results.is_empty()
        && results
            .iter()
            .all(|message| message.status != "succeeded" && !message.requires_user_confirmation)
    {
        state.consecutive_failure_rounds += 1;
    } else {
        state.consecutive_failure_rounds = 0;
    }

    if state.consecutive_failure_rounds >= policy.max_consecutive_failure_rounds {
        return Some(FinalAnswerReason::ConsecutiveToolFailures);
    }

    let mut has_new_information = false;
    for result in results {
        let signature = observation_signature(result);
        if state.observation_signatures.insert(signature) {
            has_new_information = true;
        }
    }

    if has_new_information {
        state.no_new_info_rounds = 0;
    } else {
        state.no_new_info_rounds += 1;
    }

    if state.no_new_info_rounds >= policy.max_no_new_info_rounds {
        return Some(FinalAnswerReason::NoNewInformation);
    }

    None
}

fn observation_signature(result: &AgentToolResultMessage) -> String {
    let mut hasher = DefaultHasher::new();
    result.tool_name.hash(&mut hasher);
    result.status.hash(&mut hasher);
    result.summary.hash(&mut hasher);
    if let Some(output_ref) = result.output_ref.as_deref() {
        if let Some(content) = load_tool_output_ref(output_ref) {
            content.hash(&mut hasher);
        }
    }
    format!("{:x}", hasher.finish())
}

fn cancelled_error() -> String {
    errors::error("AI_REQUEST_CANCELLED", "Agent provider loop was cancelled.")
}

fn validate_loop_request(request: &AgentProviderLoopRequest) -> Result<(), String> {
    if request.run_id.trim().is_empty() {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "Agent provider loop runId cannot be empty.",
        ));
    }
    if request.messages.is_empty() {
        return Err(errors::error(
            "AI_RESPONSE_INVALID",
            "Agent provider loop requires at least one message.",
        ));
    }
    Ok(())
}

fn finalize_loop_with_no_tools<F>(
    reason: FinalAnswerReason,
    model_hint: &str,
    call_provider: &mut F,
    messages: &mut Vec<AiProviderMessage>,
    run_messages: &mut Vec<AgentRunMessage>,
    turns: usize,
) -> AgentProviderLoopOutcome
where
    F: FnMut(AiProviderChatRequest) -> Result<AiProviderResponse, String>,
{
    append_final_answer_prompt(messages, &reason, run_messages);

    let final_response =
        call_provider(AiProviderChatRequest::new(messages.clone()).with_tool_choice_none())
            .ok()
            .map(|response| normalize_final_response(response, model_hint, &reason, run_messages))
            .unwrap_or_else(|| {
                build_user_facing_partial_response(model_hint, &reason, run_messages)
            });

    AgentProviderLoopOutcome {
        final_response,
        messages: mem::take(messages),
        run_messages: mem::take(run_messages),
        turns,
        stop_reason: STOP_REASON_COMPLETED.to_string(),
    }
}

async fn finalize_loop_with_no_tools_async<F, Fut>(
    reason: FinalAnswerReason,
    model_hint: &str,
    call_provider: &mut F,
    messages: &mut Vec<AiProviderMessage>,
    run_messages: &mut Vec<AgentRunMessage>,
    turns: usize,
) -> AgentProviderLoopOutcome
where
    F: FnMut(AiProviderChatRequest) -> Fut,
    Fut: Future<Output = Result<AiProviderResponse, String>>,
{
    append_final_answer_prompt(messages, &reason, run_messages);

    let final_response =
        call_provider(AiProviderChatRequest::new(messages.clone()).with_tool_choice_none())
            .await
            .ok()
            .map(|response| normalize_final_response(response, model_hint, &reason, run_messages))
            .unwrap_or_else(|| {
                build_user_facing_partial_response(model_hint, &reason, run_messages)
            });

    AgentProviderLoopOutcome {
        final_response,
        messages: mem::take(messages),
        run_messages: mem::take(run_messages),
        turns,
        stop_reason: STOP_REASON_COMPLETED.to_string(),
    }
}

fn append_final_answer_prompt(
    messages: &mut Vec<AiProviderMessage>,
    reason: &FinalAnswerReason,
    run_messages: &[AgentRunMessage],
) {
    messages.push(AiProviderMessage::system(format!(
        "{}\n\n触发原因：{}。\n\n已有工具观察摘要：\n{}\n\n从现在开始禁止调用任何工具。你必须基于已有上下文直接回答用户。不要向用户输出“达到最大工具调用次数”“工具预算耗尽”等内部状态。信息不足时，请说明目前可以确定的内容、不确定的内容，以及下一步只需要补充什么。",
        "Agent Runtime 已切换到 FINAL_ANSWER_WITH_PARTIAL_CONTEXT 模式。",
        final_answer_reason_label(reason),
        tool_observation_digest(run_messages),
    )));
}

fn normalize_final_response(
    response: AiProviderResponse,
    model_hint: &str,
    reason: &FinalAnswerReason,
    run_messages: &[AgentRunMessage],
) -> AiProviderResponse {
    let content = response.content.trim();
    if content.is_empty() {
        return build_user_facing_partial_response(model_hint, reason, run_messages);
    }

    AiProviderResponse::new(content, response.model)
}

fn build_user_facing_partial_response(
    model: &str,
    reason: &FinalAnswerReason,
    run_messages: &[AgentRunMessage],
) -> AiProviderResponse {
    let digest = tool_observation_digest(run_messages);
    let content = if digest.trim().is_empty() {
        format!(
            "我已经停止继续探索，避免无效重复。\n\n目前没有成功获取到更多外部信息，但可以先基于你的问题继续处理：请补充当前文件内容，或允许我读取当前文件一次后，我会直接给出可复制的修改版本。\n\n下一步只需要补充：{}。",
            final_answer_next_step(reason)
        )
    } else {
        format!(
            "我已经基于目前获得的信息做出判断。\n\n目前可以确定的是：\n{}\n\n不确定的是：仍缺少完整上下文时，部分细节可能需要你确认。\n\n如果要继续提高准确性，下一步只需要补充：{}。",
            digest,
            final_answer_next_step(reason)
        )
    };

    AiProviderResponse::new(content, model)
}

fn final_answer_reason_label(reason: &FinalAnswerReason) -> String {
    match reason {
        FinalAnswerReason::ToolBudgetExceeded => "工具调用预算已用完".to_string(),
        FinalAnswerReason::DuplicateToolCall => "检测到重复工具调用".to_string(),
        FinalAnswerReason::ToolNotAllowed(tool) => {
            format!("当前任务策略不允许调用工具 {tool}")
        }
        FinalAnswerReason::NoNewInformation => "工具结果没有新增信息".to_string(),
        FinalAnswerReason::ConsecutiveToolFailures => "工具连续失败".to_string(),
        FinalAnswerReason::RuntimeTimeout => "运行时间达到上限".to_string(),
    }
}

fn final_answer_next_step(reason: &FinalAnswerReason) -> &'static str {
    match reason {
        FinalAnswerReason::ToolNotAllowed(_) => "确认是否需要扩大本任务的工具权限",
        FinalAnswerReason::ConsecutiveToolFailures => "确认文件路径、权限或工具输入是否正确",
        FinalAnswerReason::RuntimeTimeout => "缩小问题范围或明确只处理哪个文件",
        FinalAnswerReason::DuplicateToolCall
        | FinalAnswerReason::NoNewInformation
        | FinalAnswerReason::ToolBudgetExceeded => "基于当前结果继续生成答案或明确一个更小的目标",
    }
}

fn tool_observation_digest(run_messages: &[AgentRunMessage]) -> String {
    let mut items = run_messages
        .iter()
        .filter_map(tool_result_message)
        .rev()
        .take(4)
        .map(|message| {
            let excerpt = message
                .output_ref
                .as_deref()
                .and_then(stored_tool_ref_excerpt)
                .map(|value| value.lines().take(8).collect::<Vec<_>>().join("\n"))
                .filter(|value| !value.trim().is_empty());

            match excerpt {
                Some(excerpt) => {
                    format!("- {}：{}\n{}", message.tool_name, message.summary, excerpt)
                }
                None => format!("- {}：{}", message.tool_name, message.summary),
            }
        })
        .collect::<Vec<_>>();
    items.reverse();
    items.join("\n")
}

fn provider_messages_from_tool_message(message: &AgentRunMessage) -> Vec<AiProviderMessage> {
    match message {
        AgentRunMessage::ToolCall(call) => {
            let mut messages = vec![AiProviderMessage::system(format!(
                "ToolCall: name={}, stepId={}, inputRef={}",
                call.tool_name,
                call.step_id,
                call.input_ref.as_deref().unwrap_or("none")
            ))];
            if let Some(input_ref) = call.input_ref.as_deref() {
                if let Some(content) = stored_tool_ref_excerpt(input_ref) {
                    messages.push(AiProviderMessage::system(format!(
                        "ToolCallInputExcerpt: name={}, excerpt=\n{}",
                        call.tool_name, content
                    )));
                }
            }
            messages
        }
        AgentRunMessage::ToolResult(result) => {
            let mut messages = vec![AiProviderMessage::system(format!(
                "ToolResult: name={}, status={}, requiresConfirmation={}, summary={}, outputRef={}",
                result.tool_name,
                result.status,
                result.requires_user_confirmation,
                result.summary,
                result.output_ref.as_deref().unwrap_or("none")
            ))];
            if let Some(output_ref) = result.output_ref.as_deref() {
                if let Some(content) = stored_tool_ref_excerpt(output_ref) {
                    messages.push(AiProviderMessage::system(format!(
                        "ToolResultExcerpt: name={}, excerpt=\n{}",
                        result.tool_name, content
                    )));
                }
            }
            messages
        }
    }
}

fn stored_tool_ref_excerpt(ref_id: &str) -> Option<String> {
    let content = load_tool_output_ref(ref_id)?;
    let clipped = content
        .chars()
        .take(MAX_PROVIDER_TOOL_EXCERPT_CHARS)
        .collect::<String>();
    if clipped.trim().is_empty() {
        return None;
    }
    if content.chars().count() <= MAX_PROVIDER_TOOL_EXCERPT_CHARS {
        return Some(clipped);
    }
    Some(format!("{clipped}\n\n[tool excerpt truncated]"))
}

fn tool_call_signatures(tool_calls: &[AiProviderToolCall]) -> Result<Vec<String>, String> {
    tool_calls
        .iter()
        .map(|call| {
            let arguments = serde_json::to_string(&call.arguments).map_err(|error| {
                errors::error(
                    "AI_AGENT_PLAN_INVALID",
                    format!("Failed to normalize tool call arguments: {error}"),
                )
            })?;
            Ok(format!("{}::{arguments}", call.name))
        })
        .collect()
}

fn tool_result_message(message: &AgentRunMessage) -> Option<&AgentToolResultMessage> {
    match message {
        AgentRunMessage::ToolResult(result) => Some(result),
        AgentRunMessage::ToolCall(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{run_agent_provider_loop, run_agent_provider_loop_async, AgentProviderLoopRequest};
    use crate::ai::provider::{AiProviderMessage, AiProviderResponse, AiProviderToolCall};
    use crate::commands::contracts::AiContextReferencePayload;
    use serde_json::json;
    use std::collections::HashMap;
    use std::fs;

    #[test]
    fn completes_without_tool_calls() {
        let request = AgentProviderLoopRequest {
            run_id: "run-loop-1".to_string(),
            messages: vec![AiProviderMessage::user("hello")],
            workspace_root: None,
            references: Vec::new(),
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(2),
        };

        let outcome = run_agent_provider_loop(
            request,
            None,
            |_| Ok(AiProviderResponse::new("done", "mock")),
            || false,
        )
        .expect("loop should complete");

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(outcome.turns, 1);
        assert!(outcome.run_messages.is_empty());
    }

    #[test]
    fn executes_tool_call_and_feeds_result_back_to_provider() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-provider-loop-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");

        let request = AgentProviderLoopRequest {
            run_id: "run-loop-2".to_string(),
            messages: vec![AiProviderMessage::user("inspect project")],
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(2),
        };

        let mut calls = 0usize;
        let outcome = run_agent_provider_loop(
            request,
            None,
            |provider_request| {
                calls += 1;
                assert!(provider_request
                    .tools
                    .iter()
                    .any(|tool| tool.name == "get_project_tree"));
                if calls == 1 {
                    Ok(AiProviderResponse::with_tool_calls(
                        "",
                        "mock",
                        vec![AiProviderToolCall {
                            id: "call-tree".to_string(),
                            name: "get_project_tree".to_string(),
                            arguments: json!({}),
                        }],
                    ))
                } else {
                    assert!(provider_request
                        .messages
                        .iter()
                        .any(|message| message.content.contains("ToolResult")));
                    assert!(provider_request
                        .messages
                        .iter()
                        .any(|message| message.content.contains("ToolResultExcerpt")));
                    Ok(AiProviderResponse::new("final", "mock"))
                }
            },
            || false,
        )
        .expect("loop should complete");

        let _ = fs::remove_dir_all(&workspace_root);

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(outcome.turns, 2);
        assert_eq!(outcome.run_messages.len(), 2);
    }

    #[test]
    fn current_file_edit_reads_file_content_once_and_reaches_final_answer() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-provider-current-file-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let file_path = workspace_root.join("test.sh");
        fs::write(&file_path, "#!/usr/bin/env bash\necho old\n")
            .expect("current file should be written");

        let request = AgentProviderLoopRequest {
            run_id: "run-current-file-edit".to_string(),
            messages: vec![AiProviderMessage::user(
                "@current-file · test.sh\n丰富一下目前的脚本内容",
            )],
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: vec![AiContextReferencePayload {
                id: "ctx-current-file".to_string(),
                kind: "current-file".to_string(),
                label: "test.sh".to_string(),
                path: Some("test.sh".to_string()),
                range: None,
                content_preview: "#!/usr/bin/env bash".to_string(),
                redacted: false,
            }],
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(8),
        };

        let mut calls = 0usize;
        let outcome = run_agent_provider_loop(
            request,
            None,
            |provider_request| {
                calls += 1;
                assert!(!provider_request
                    .tools
                    .iter()
                    .any(|tool| tool.name == "get_project_tree"));
                assert!(
                    provider_request.tools.is_empty()
                        || provider_request
                            .tools
                            .iter()
                            .any(|tool| tool.name == "read_file")
                );

                if calls == 1 {
                    return Ok(AiProviderResponse::with_tool_calls(
                        "",
                        "mock",
                        vec![AiProviderToolCall {
                            id: "call-read-current".to_string(),
                            name: "read_file".to_string(),
                            arguments: json!({ "path": "test.sh" }),
                        }],
                    ));
                }

                assert!(provider_request
                    .messages
                    .iter()
                    .any(|message| message.content.contains("echo old")));
                Ok(AiProviderResponse::new(
                    "我已经读取 test.sh，并给出增强后的脚本处理方案。",
                    "mock",
                ))
            },
            || false,
        )
        .expect("current file edit should complete");

        let _ = fs::remove_dir_all(&workspace_root);

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(outcome.turns, 2);
        assert_eq!(outcome.run_messages.len(), 2);
        assert!(outcome.final_response.content.contains("增强后的脚本"));
    }

    #[test]
    fn pauses_when_tool_confirmation_is_required() {
        let request = AgentProviderLoopRequest {
            run_id: "run-loop-3".to_string(),
            messages: vec![AiProviderMessage::user("run command")],
            workspace_root: None,
            references: Vec::new(),
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(2),
        };

        let outcome = run_agent_provider_loop(
            request,
            None,
            |provider_request| {
                if provider_request.tools.is_empty() {
                    return Ok(AiProviderResponse::new(
                        "我已经基于目前获得的信息做出判断：可以先按已有上下文继续处理。",
                        "mock",
                    ));
                }
                Ok(AiProviderResponse::with_tool_calls(
                    "",
                    "mock",
                    vec![AiProviderToolCall {
                        id: "call-command".to_string(),
                        name: "run_command".to_string(),
                        arguments: json!({
                            "command": "cargo test --help",
                            "reason": "test confirmation pause",
                            "cwdPolicy": "workspace-root",
                            "timeoutMs": 30000
                        }),
                    }],
                ))
            },
            || false,
        )
        .expect("loop should pause");

        assert_eq!(outcome.stop_reason, "tool-confirmation-required");
        assert_eq!(outcome.turns, 1);
        assert_eq!(outcome.run_messages.len(), 2);
        assert!(outcome
            .messages
            .iter()
            .any(|message| message.content.contains("requiresConfirmation=true")));
        assert!(outcome
            .run_messages
            .iter()
            .filter_map(super::tool_result_message)
            .any(|message| message.requires_user_confirmation));
    }

    #[test]
    fn completes_with_guarded_response_when_max_tool_turns_is_reached() {
        let request = AgentProviderLoopRequest {
            run_id: "run-loop-4".to_string(),
            messages: vec![AiProviderMessage::user("loop")],
            workspace_root: None,
            references: Vec::new(),
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(1),
        };

        let outcome = run_agent_provider_loop(
            request,
            None,
            |_| {
                Ok(AiProviderResponse::with_tool_calls(
                    "",
                    "mock",
                    vec![AiProviderToolCall {
                        id: "call-tree".to_string(),
                        name: "get_project_tree".to_string(),
                        arguments: json!({}),
                    }],
                ))
            },
            || false,
        )
        .expect("loop should stop gracefully at max turns");

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(outcome.turns, 2);
        assert!(outcome.final_response.tool_calls.is_empty());
        assert!(outcome
            .final_response
            .content
            .contains("我已经基于目前获得的信息做出判断"));
        assert!(!outcome
            .final_response
            .content
            .contains("AI_AGENT_REPLAN_REQUIRED"));
    }

    #[test]
    fn completes_when_same_tool_name_budget_is_exceeded_with_different_arguments() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-provider-loop-tool-budget-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");

        let request = AgentProviderLoopRequest {
            run_id: "run-loop-tool-budget".to_string(),
            messages: vec![AiProviderMessage::user("keep searching")],
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(8),
        };

        let mut calls = 0usize;
        let outcome = run_agent_provider_loop(
            request,
            None,
            |provider_request| {
                calls += 1;
                if provider_request.tools.is_empty() {
                    return Ok(AiProviderResponse::new(
                        "我已经基于目前获得的信息做出判断：搜索结果已经足够形成结论。",
                        "mock",
                    ));
                }
                Ok(AiProviderResponse::with_tool_calls(
                    "",
                    "mock",
                    vec![AiProviderToolCall {
                        id: format!("call-search-{calls}"),
                        name: "search_files".to_string(),
                        arguments: json!({
                            "query": format!("query-{calls}")
                        }),
                    }],
                ))
            },
            || false,
        )
        .expect("loop should stop repeated same tool names gracefully");

        let _ = fs::remove_dir_all(&workspace_root);

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(calls, 7);
        assert_eq!(outcome.run_messages.len(), 10);
        assert!(outcome
            .final_response
            .content
            .contains("我已经基于目前获得的信息做出判断"));
        assert!(outcome.final_response.tool_calls.is_empty());
    }

    #[test]
    fn blocks_repeated_identical_tool_calls_without_calling_provider_again() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-provider-loop-repeat-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");

        let request = AgentProviderLoopRequest {
            run_id: "run-loop-duplicate".to_string(),
            messages: vec![AiProviderMessage::user("inspect current project")],
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(3),
        };

        let mut calls = 0usize;
        let outcome = run_agent_provider_loop(
            request,
            None,
            |provider_request| {
                calls += 1;
                if provider_request.tools.is_empty() {
                    return Ok(AiProviderResponse::new(
                        "我已经基于目前获得的信息做出判断：不需要继续重复读取项目结构。",
                        "mock",
                    ));
                }
                Ok(AiProviderResponse::with_tool_calls(
                    "",
                    "mock",
                    vec![AiProviderToolCall {
                        id: "call-tree".to_string(),
                        name: "get_project_tree".to_string(),
                        arguments: json!({}),
                    }],
                ))
            },
            || false,
        )
        .expect("loop should stop repeated duplicate tool calls");

        let _ = fs::remove_dir_all(&workspace_root);

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(outcome.turns, 2);
        assert_eq!(calls, 3);
        assert_eq!(outcome.run_messages.len(), 2);
        assert!(outcome
            .final_response
            .content
            .contains("不需要继续重复读取项目结构"));
        assert!(outcome.final_response.tool_calls.is_empty());
        assert!(outcome.messages.iter().any(|message| message
            .content
            .contains("FINAL_ANSWER_WITH_PARTIAL_CONTEXT")));
    }

    #[test]
    fn current_file_edit_forces_final_when_provider_requests_disallowed_tool() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-provider-disallowed-tool-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        fs::write(
            workspace_root.join("test.sh"),
            "#!/usr/bin/env bash\necho old\n",
        )
        .expect("current file should be written");

        let request = AgentProviderLoopRequest {
            run_id: "run-current-file-disallowed-tool".to_string(),
            messages: vec![AiProviderMessage::user(
                "@current-file · test.sh\n丰富一下目前的脚本内容",
            )],
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: vec![AiContextReferencePayload {
                id: "ctx-current-file".to_string(),
                kind: "current-file".to_string(),
                label: "test.sh".to_string(),
                path: Some("test.sh".to_string()),
                range: None,
                content_preview: "#!/usr/bin/env bash".to_string(),
                redacted: false,
            }],
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(8),
        };

        let mut calls = 0usize;
        let outcome = run_agent_provider_loop(
            request,
            None,
            |provider_request| {
                calls += 1;
                if calls == 1 {
                    assert!(!provider_request
                        .tools
                        .iter()
                        .any(|tool| tool.name == "get_project_tree"));
                    return Ok(AiProviderResponse::with_tool_calls(
                        "",
                        "mock",
                        vec![AiProviderToolCall {
                            id: "call-disallowed-tree".to_string(),
                            name: "get_project_tree".to_string(),
                            arguments: json!({ "reason": "over explore" }),
                        }],
                    ));
                }

                assert!(provider_request.force_tool_choice_none);
                assert!(provider_request.tools.is_empty());
                Ok(AiProviderResponse::new(
                    "我会基于当前文件编辑任务继续处理，不再读取项目树。",
                    "mock",
                ))
            },
            || false,
        )
        .expect("loop should force a final answer for disallowed tools");

        let _ = fs::remove_dir_all(&workspace_root);

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(calls, 2);
        assert!(outcome.run_messages.is_empty());
        assert!(outcome.final_response.tool_calls.is_empty());
        assert!(outcome.final_response.content.contains("不再读取项目树"));
    }

    #[test]
    fn completes_with_final_answer_when_observations_add_no_new_information() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-provider-no-new-info-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        fs::write(workspace_root.join("package.json"), "{}").expect("file should be written");

        let request = AgentProviderLoopRequest {
            run_id: "run-no-new-information".to_string(),
            messages: vec![AiProviderMessage::user("分析这个项目结构")],
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(8),
        };

        let mut calls = 0usize;
        let outcome = run_agent_provider_loop(
            request,
            None,
            |provider_request| {
                calls += 1;
                if provider_request.force_tool_choice_none {
                    assert!(provider_request.tools.is_empty());
                    return Ok(AiProviderResponse::new(
                        "我已经基于已有项目结构信息给出判断，不再重复读取相同结果。",
                        "mock",
                    ));
                }

                Ok(AiProviderResponse::with_tool_calls(
                    "",
                    "mock",
                    vec![AiProviderToolCall {
                        id: format!("call-tree-{calls}"),
                        name: "get_project_tree".to_string(),
                        arguments: json!({ "reason": format!("round-{calls}") }),
                    }],
                ))
            },
            || false,
        )
        .expect("loop should force final answer when observations repeat");

        let _ = fs::remove_dir_all(&workspace_root);

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(calls, 4);
        assert_eq!(outcome.run_messages.len(), 6);
        assert!(outcome.final_response.tool_calls.is_empty());
        assert!(outcome
            .final_response
            .content
            .contains("不再重复读取相同结果"));
    }

    #[test]
    fn current_file_edit_forces_final_after_consecutive_tool_failure() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-provider-tool-failure-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");

        let request = AgentProviderLoopRequest {
            run_id: "run-current-file-tool-failure".to_string(),
            messages: vec![AiProviderMessage::user(
                "@current-file · missing.sh\n丰富一下目前的脚本内容",
            )],
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: vec![AiContextReferencePayload {
                id: "ctx-current-file".to_string(),
                kind: "current-file".to_string(),
                label: "missing.sh".to_string(),
                path: Some("missing.sh".to_string()),
                range: None,
                content_preview: String::new(),
                redacted: false,
            }],
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(8),
        };

        let mut calls = 0usize;
        let outcome = run_agent_provider_loop(
            request,
            None,
            |provider_request| {
                calls += 1;
                if provider_request.force_tool_choice_none {
                    return Ok(AiProviderResponse::new(
                        "当前文件读取失败；请确认 missing.sh 是否存在，或重新选择当前文件。",
                        "mock",
                    ));
                }

                Ok(AiProviderResponse::with_tool_calls(
                    "",
                    "mock",
                    vec![AiProviderToolCall {
                        id: "call-read-missing-file".to_string(),
                        name: "read_file".to_string(),
                        arguments: json!({ "path": "missing.sh" }),
                    }],
                ))
            },
            || false,
        )
        .expect("loop should force final answer after tool failure");

        let _ = fs::remove_dir_all(&workspace_root);

        assert_eq!(outcome.stop_reason, "completed");
        assert_eq!(calls, 2);
        assert_eq!(outcome.run_messages.len(), 2);
        assert!(outcome.final_response.tool_calls.is_empty());
        assert!(outcome.final_response.content.contains("当前文件读取失败"));
    }

    #[tokio::test]
    async fn async_loop_respects_cancellation_before_provider_call() {
        let request = AgentProviderLoopRequest {
            run_id: "run-loop-5".to_string(),
            messages: vec![AiProviderMessage::user("cancel")],
            workspace_root: None,
            references: Vec::new(),
            tool_decisions: HashMap::new(),
            max_tool_turns: Some(2),
        };

        let error = run_agent_provider_loop_async(
            request,
            None,
            |_| async { Ok(AiProviderResponse::new("should not be called", "mock")) },
            || true,
        )
        .await
        .expect_err("loop should be cancelled before provider call");

        assert!(error.contains("AI_REQUEST_CANCELLED"));
    }
}
