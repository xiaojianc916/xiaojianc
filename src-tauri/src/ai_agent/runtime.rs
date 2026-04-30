use std::collections::HashMap;
use std::fs;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::ai_agent::planner;
use crate::ai_agent::tool_loop::{
    build_tool_loop_messages_with_services, validate_step_tools, AgentRunMessage,
    AgentToolRuntimeServices, AgentToolUseContext,
};
use crate::commands::contracts::{
    AiAgentListRunsPayload, AiAgentNetworkPermissionPayload, AiAgentResolveToolConfirmationRequest,
    AiAgentRunEnvelopePayload, AiAgentRunIdRequest, AiAgentRunPayload, AiAgentRunPlanRequest,
    AiAgentRunStepRequest, AiAgentSetNetworkPermissionRequest, AiContextReferencePayload,
    AiTaskPlanStepPayload, AiToolConfirmationOptionPayload, AiToolConfirmationRequestPayload,
};
use crate::commands::resolve_workspace_root;

static RUNS: OnceLock<Mutex<HashMap<String, AiAgentRunPayload>>> = OnceLock::new();
static RUN_MESSAGES: OnceLock<Mutex<HashMap<String, Vec<AgentRunMessage>>>> = OnceLock::new();
static RUN_CONTEXTS: OnceLock<Mutex<HashMap<String, Vec<AiContextReferencePayload>>>> =
    OnceLock::new();
static TOOL_CONFIRMATIONS: OnceLock<Mutex<HashMap<String, AiToolConfirmationRequestPayload>>> =
    OnceLock::new();
static TOOL_CONFIRMATION_DECISIONS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static NETWORK_PERMISSION: OnceLock<Mutex<String>> = OnceLock::new();
static RUN_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn runs() -> &'static Mutex<HashMap<String, AiAgentRunPayload>> {
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn run_messages() -> &'static Mutex<HashMap<String, Vec<AgentRunMessage>>> {
    RUN_MESSAGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn run_contexts() -> &'static Mutex<HashMap<String, Vec<AiContextReferencePayload>>> {
    RUN_CONTEXTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn tool_confirmations() -> &'static Mutex<HashMap<String, AiToolConfirmationRequestPayload>> {
    TOOL_CONFIRMATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn tool_confirmation_decisions() -> &'static Mutex<HashMap<String, String>> {
    TOOL_CONFIRMATION_DECISIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn network_permission_state() -> &'static Mutex<String> {
    NETWORK_PERMISSION.get_or_init(|| Mutex::new("ask".to_string()))
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn next_run_id() -> String {
    let sequence = RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "agent-run-{}-{sequence}",
        chrono::Utc::now().timestamp_millis()
    )
}

pub fn run_plan(payload: AiAgentRunPlanRequest) -> Result<AiAgentRunEnvelopePayload, String> {
    let goal = payload.goal.trim();

    if goal.is_empty() {
        return Err(errors::error("AI_AGENT_PLAN_INVALID", "任务目标不能为空。"));
    }

    planner::validate_plan_steps(&payload.steps)?;

    let timestamp = now();
    let run = AiAgentRunPayload {
        id: next_run_id(),
        goal: goal.to_string(),
        status: "running-plan".to_string(),
        steps: reset_steps(payload.steps),
        current_step_id: None,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        started_at: Some(timestamp),
        completed_at: None,
        error_message: None,
    };

    let mut guard = runs().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent run 状态锁定失败，请稍后重试。",
        )
    })?;

    guard.insert(run.id.clone(), run.clone());
    initialize_run_messages(&run.id)?;
    initialize_run_context(&run.id, payload.context)?;
    audit::emit(AiAuditEventKind::AgentRunStarted);

    Ok(AiAgentRunEnvelopePayload { run })
}

pub fn run_step(payload: AiAgentRunStepRequest) -> Result<AiAgentRunEnvelopePayload, String> {
    run_step_with_services(payload, None)
}

pub fn run_step_with_services(
    payload: AiAgentRunStepRequest,
    services: Option<&dyn AgentToolRuntimeServices>,
) -> Result<AiAgentRunEnvelopePayload, String> {
    let mut guard = lock_runs()?;
    let run = get_run_mut(&mut guard, &payload.run_id)?;

    if run.status == "cancelled" || run.status == "completed" || run.status == "failed" {
        return Err(errors::error(
            "AI_AGENT_STEP_CANCELLED",
            "当前 Agent run 已结束，不能继续执行 step。",
        ));
    }

    if run.status == "paused" {
        return Err(errors::error(
            "AI_AGENT_RUN_PAUSED",
            "当前 Agent run 已暂停，请先继续运行。",
        ));
    }

    if run.status == "waiting-for-tool-confirmation" {
        return Err(errors::error(
            "AI_AGENT_TOOL_CONFIRMATION_REQUIRED",
            "当前 Agent run 正在等待工具确认。",
        ));
    }

    let step_index = resolve_step_index(run, payload.step_id.as_deref())?;
    let timestamp = now();
    let next_step_status = run.steps[step_index].status.as_str();

    match next_step_status {
        "pending" => {
            validate_step_tools(&run.steps[step_index])?;
            run.steps[step_index].status = "running".to_string();
            run.steps[step_index].is_active = Some(true);
            run.current_step_id = Some(run.steps[step_index].id.clone());
            run.status = "running-step".to_string();
            run.updated_at = timestamp;
            audit::emit(AiAuditEventKind::AgentStepStarted);
        }
        "running" => {
            let completed_step = run.steps[step_index].clone();
            if let Some(confirmation) = create_pending_confirmation_if_needed(run, &completed_step)?
            {
                run.status = "waiting-for-tool-confirmation".to_string();
                run.updated_at = timestamp;
                store_tool_confirmation(confirmation)?;
                return Ok(AiAgentRunEnvelopePayload { run: run.clone() });
            }
            let context = AgentToolUseContext {
                run_id: run.id.clone(),
                step_id: completed_step.id.clone(),
                permission_level: "standard".to_string(),
                workspace_root: None,
                references: get_run_context(&run.id)?,
                tool_decisions: get_step_tool_decisions(&run.id, &completed_step.id)?,
            };
            let tool_messages = if payload.skip_tool_execution {
                Vec::new()
            } else {
                build_tool_loop_messages_with_services(&context, &completed_step, services)?
            };

            run.steps[step_index].status = "done".to_string();
            run.steps[step_index].is_active = None;
            run.current_step_id = None;
            run.updated_at = timestamp.clone();
            audit::emit(AiAuditEventKind::AgentStepCompleted);

            if run.steps.iter().all(|step| step.status == "done") {
                run.status = "completed".to_string();
                run.completed_at = Some(timestamp);
                audit::emit(AiAuditEventKind::AgentRunCompleted);
            } else {
                run.status = "running-plan".to_string();
            }

            append_run_messages(&run.id, tool_messages)?;
        }
        "done" | "skipped" => {
            return Err(errors::error(
                "AI_AGENT_STEP_FAILED",
                "该 step 已完成或已跳过，不能重复执行。",
            ));
        }
        "failed" | "cancelled" => {
            return Err(errors::error(
                "AI_AGENT_STEP_CANCELLED",
                "该 step 已失败或已取消，请重新规划或重试。",
            ));
        }
        _ => {
            return Err(errors::error("AI_AGENT_STEP_FAILED", "该 step 状态无效。"));
        }
    }

    Ok(AiAgentRunEnvelopePayload { run: run.clone() })
}

pub fn pause(payload: AiAgentRunIdRequest) -> Result<AiAgentRunEnvelopePayload, String> {
    let mut guard = lock_runs()?;
    let run = get_run_mut(&mut guard, &payload.run_id)?;

    if run.status == "completed" || run.status == "failed" || run.status == "cancelled" {
        return Err(errors::error(
            "AI_AGENT_RUN_CANCELLED",
            "当前 Agent run 已结束，不能暂停。",
        ));
    }

    run.status = "paused".to_string();
    run.updated_at = now();

    Ok(AiAgentRunEnvelopePayload { run: run.clone() })
}

pub fn resume(payload: AiAgentRunIdRequest) -> Result<AiAgentRunEnvelopePayload, String> {
    let mut guard = lock_runs()?;
    let run = get_run_mut(&mut guard, &payload.run_id)?;

    if run.status != "paused" {
        return Err(errors::error(
            "AI_AGENT_RUN_FAILED",
            "当前 Agent run 未暂停，不能继续。",
        ));
    }

    run.status = if run.current_step_id.is_some() {
        "running-step"
    } else {
        "running-plan"
    }
    .to_string();
    run.updated_at = now();

    Ok(AiAgentRunEnvelopePayload { run: run.clone() })
}

pub fn cancel(payload: AiAgentRunIdRequest) -> Result<AiAgentRunEnvelopePayload, String> {
    let mut guard = lock_runs()?;
    let run = get_run_mut(&mut guard, &payload.run_id)?;

    for step in &mut run.steps {
        if step.status == "running" {
            step.status = "cancelled".to_string();
            step.is_active = None;
        }
    }

    let timestamp = now();
    run.status = "cancelled".to_string();
    run.current_step_id = None;
    run.updated_at = timestamp.clone();
    run.completed_at = Some(timestamp);

    Ok(AiAgentRunEnvelopePayload { run: run.clone() })
}

pub fn get_run(payload: AiAgentRunIdRequest) -> Result<AiAgentRunEnvelopePayload, String> {
    let guard = lock_runs()?;
    let run = guard
        .get(payload.run_id.trim())
        .ok_or_else(|| errors::error("AI_AGENT_STEP_NOT_FOUND", "未找到指定 Agent run。"))?;

    Ok(AiAgentRunEnvelopePayload { run: run.clone() })
}

pub fn list_runs() -> Result<AiAgentListRunsPayload, String> {
    let guard = lock_runs()?;
    let mut runs = guard.values().cloned().collect::<Vec<_>>();
    runs.sort_by(|left, right| right.created_at.cmp(&left.created_at));

    Ok(AiAgentListRunsPayload { runs })
}

pub fn set_network_permission(
    payload: AiAgentSetNetworkPermissionRequest,
) -> Result<AiAgentNetworkPermissionPayload, String> {
    let permission = payload.permission.trim();

    if !matches!(permission, "off" | "ask" | "allowed-this-run") {
        return Err(errors::error(
            "AI_AGENT_TOOL_NOT_ALLOWED",
            "AI Agent 网络权限值无效。",
        ));
    }

    let mut guard = network_permission_state().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "AI Agent 网络权限状态锁定失败，请稍后重试。",
        )
    })?;

    *guard = permission.to_string();
    audit::emit(AiAuditEventKind::AgentPermissionChanged);

    Ok(AiAgentNetworkPermissionPayload {
        permission: permission.to_string(),
    })
}

pub fn resolve_tool_confirmation(
    payload: AiAgentResolveToolConfirmationRequest,
) -> Result<AiAgentRunEnvelopePayload, String> {
    let decision = payload.decision.trim();
    if !matches!(decision, "allow-once" | "allow-run" | "skip" | "stop") {
        return Err(errors::error(
            "AI_AGENT_TOOL_NOT_ALLOWED",
            "工具确认选项无效。",
        ));
    }

    let confirmation = remove_tool_confirmation(&payload.confirmation_id)?;
    if confirmation.run_id != payload.run_id {
        return Err(errors::error(
            "AI_AGENT_STEP_NOT_FOUND",
            "工具确认不属于当前 Agent run。",
        ));
    }

    if decision == "stop" {
        return cancel(AiAgentRunIdRequest {
            run_id: payload.run_id,
        });
    }

    remember_tool_decision(&confirmation, decision)?;

    let mut guard = lock_runs()?;
    let run = get_run_mut(&mut guard, &confirmation.run_id)?;
    if run.status == "waiting-for-tool-confirmation" {
        run.status = "running-step".to_string();
    }
    run.current_step_id = Some(confirmation.step_id);
    run.updated_at = now();

    Ok(AiAgentRunEnvelopePayload { run: run.clone() })
}

pub fn pending_tool_confirmation(run_id: &str) -> Option<AiToolConfirmationRequestPayload> {
    tool_confirmations()
        .lock()
        .ok()
        .and_then(|guard| guard.values().find(|item| item.run_id == run_id).cloned())
}

pub fn network_permission() -> Result<String, String> {
    let guard = network_permission_state().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "AI Agent 网络权限状态锁定失败，请稍后重试。",
        )
    })?;

    Ok(guard.clone())
}

pub fn ensure_network_allowed() -> Result<(), String> {
    match network_permission()?.as_str() {
        "allowed-this-run" => Ok(()),
        "off" => Err(errors::error(
            "AI_AGENT_NETWORK_NOT_ALLOWED",
            "AI Agent 网络访问已关闭。",
        )),
        "ask" => Err(errors::error(
            "AI_AGENT_TOOL_CONFIRMATION_REQUIRED",
            "AI Agent 联网前需要用户授权。",
        )),
        _ => Err(errors::error(
            "AI_AGENT_NETWORK_NOT_ALLOWED",
            "AI Agent 网络权限状态无效。",
        )),
    }
}

fn initialize_run_messages(run_id: &str) -> Result<(), String> {
    let mut guard = run_messages().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent run message 状态锁定失败，请稍后重试。",
        )
    })?;

    guard.insert(run_id.to_string(), Vec::new());
    Ok(())
}

fn initialize_run_context(
    run_id: &str,
    context: Vec<AiContextReferencePayload>,
) -> Result<(), String> {
    let mut guard = run_contexts().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent run context 状态锁定失败，请稍后重试。",
        )
    })?;

    guard.insert(run_id.to_string(), context);
    Ok(())
}

fn get_run_context(run_id: &str) -> Result<Vec<AiContextReferencePayload>, String> {
    let guard = run_contexts().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent run context 状态锁定失败，请稍后重试。",
        )
    })?;

    Ok(guard.get(run_id).cloned().unwrap_or_default())
}

fn create_pending_confirmation_if_needed(
    run: &AiAgentRunPayload,
    step: &AiTaskPlanStepPayload,
) -> Result<Option<AiToolConfirmationRequestPayload>, String> {
    let decisions = get_step_tool_decisions(&run.id, &step.id)?;
    let Some(tool_name) = step.tools.iter().find(|tool_name| {
        crate::ai_tools::registry::requires_confirmation(tool_name)
            && !decisions.contains_key(tool_name.as_str())
    }) else {
        return Ok(None);
    };

    let created_at = now();
    let summary = tool_confirmation_summary(tool_name, step);
    let confirmation = AiToolConfirmationRequestPayload {
        id: format!("tool-confirmation:{}:{}:{}", run.id, step.id, tool_name),
        run_id: run.id.clone(),
        step_id: step.id.clone(),
        tool_name: tool_name.clone(),
        question: format!("允许 Agent 使用 {tool_name} 吗？"),
        summary,
        risk_level: tool_risk_level(tool_name).to_string(),
        impact: Some(tool_impact_summary(tool_name).to_string()),
        reversible: tool_is_reversible(tool_name),
        created_at,
        options: vec![
            AiToolConfirmationOptionPayload {
                id: "allow-once".to_string(),
                label: "允许本次".to_string(),
                tone: Some("primary".to_string()),
            },
            AiToolConfirmationOptionPayload {
                id: "skip".to_string(),
                label: "跳过".to_string(),
                tone: Some("secondary".to_string()),
            },
            AiToolConfirmationOptionPayload {
                id: "stop".to_string(),
                label: "停止任务".to_string(),
                tone: Some("danger".to_string()),
            },
        ],
    };

    Ok(Some(confirmation))
}

fn store_tool_confirmation(confirmation: AiToolConfirmationRequestPayload) -> Result<(), String> {
    let mut guard = tool_confirmations().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent 工具确认状态锁定失败，请稍后重试。",
        )
    })?;

    guard.insert(confirmation.id.clone(), confirmation);
    Ok(())
}

fn remove_tool_confirmation(id: &str) -> Result<AiToolConfirmationRequestPayload, String> {
    let mut guard = tool_confirmations().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent 工具确认状态锁定失败，请稍后重试。",
        )
    })?;

    guard
        .remove(id.trim())
        .ok_or_else(|| errors::error("AI_AGENT_STEP_NOT_FOUND", "未找到待处理的工具确认。"))
}

fn remember_tool_decision(
    confirmation: &AiToolConfirmationRequestPayload,
    decision: &str,
) -> Result<(), String> {
    let mut guard = tool_confirmation_decisions().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent 工具确认决策锁定失败，请稍后重试。",
        )
    })?;

    guard.insert(
        tool_decision_key(
            &confirmation.run_id,
            &confirmation.step_id,
            &confirmation.tool_name,
        ),
        decision.to_string(),
    );
    Ok(())
}

fn get_step_tool_decisions(run_id: &str, step_id: &str) -> Result<HashMap<String, String>, String> {
    let guard = tool_confirmation_decisions().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent 工具确认决策锁定失败，请稍后重试。",
        )
    })?;
    let prefix = format!("{run_id}:{step_id}:");

    Ok(guard
        .iter()
        .filter_map(|(key, decision)| {
            key.strip_prefix(&prefix)
                .map(|tool_name| (tool_name.to_string(), decision.clone()))
        })
        .collect())
}

fn tool_decision_key(run_id: &str, step_id: &str, tool_name: &str) -> String {
    format!("{run_id}:{step_id}:{tool_name}")
}

fn tool_risk_level(tool_name: &str) -> &'static str {
    match tool_name {
        "run_command" | "stage_file" | "create_commit" => "high",
        "auto_apply_patch" | "propose_patch" | "run_test" => "medium",
        "web_search" | "web_fetch" => "medium",
        _ => "low",
    }
}

fn tool_impact_summary(tool_name: &str) -> &'static str {
    match tool_name {
        "web_search" | "web_fetch" => "会把脱敏后的 query 或 URL 发送到网络工具，并保留来源记录。",
        "propose_patch" | "auto_apply_patch" => {
            "可能生成或应用工作区 patch；实际写盘仍必须经过 AED 链路。"
        }
        "run_test" => "会执行项目测试命令；输出将截断并 ref 化。",
        "run_command" => "会执行命令；危险命令仍会被阻断或要求额外确认。",
        "stage_file" => "会修改 Git index，但不会自动 commit 或 push。",
        "create_commit" => "会创建本地 Git commit，但不会自动 push。",
        _ => "该工具需要用户确认后才会继续。",
    }
}

fn tool_is_reversible(tool_name: &str) -> bool {
    !matches!(tool_name, "create_commit")
}

fn tool_confirmation_summary(tool_name: &str, step: &AiTaskPlanStepPayload) -> String {
    if tool_name == "run_test" {
        if let Some(command) = describe_run_test_command() {
            return format!("Step `{}` requests test command `{command}`.", step.title);
        }
    }

    if tool_name == "run_command" {
        if let Some(input) = step
            .tool_inputs
            .as_ref()
            .and_then(|tool_inputs| tool_inputs.run_command.as_ref())
        {
            return format!(
                "Step `{}` requests command `{}`. Reason: {}",
                step.title,
                inline_command_preview(&input.command),
                inline_command_preview(&input.reason)
            );
        }
    }

    if tool_name == "stage_file" {
        if let Some(input) = step
            .tool_inputs
            .as_ref()
            .and_then(|tool_inputs| tool_inputs.stage_file.as_ref())
        {
            return format!(
                "Step `{}` requests staging {} file(s). Reason: {}",
                step.title,
                input.paths.len(),
                inline_command_preview(&input.reason)
            );
        }
    }

    if tool_name == "create_commit" {
        if let Some(input) = step
            .tool_inputs
            .as_ref()
            .and_then(|tool_inputs| tool_inputs.create_commit.as_ref())
        {
            return format!(
                "Step `{}` requests local commit `{}`. Reason: {}",
                step.title,
                inline_command_preview(&input.message),
                inline_command_preview(&input.reason)
            );
        }
    }

    format!(
        "Step `{}` requests a tool that requires confirmation.",
        step.title
    )
}

fn inline_command_preview(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= 160 {
        return normalized;
    }

    format!("{}...", normalized.chars().take(160).collect::<String>())
}
fn describe_run_test_command() -> Option<String> {
    let workspace_root = resolve_workspace_root(None).ok()?;
    let scripts = package_scripts_for_confirmation(&workspace_root);
    let selected = scripts
        .iter()
        .filter(|script| script.0.contains("test"))
        .min_by_key(|script| if script.0 == "test" { 0 } else { 1 })?;

    Some(format!("pnpm run {}", selected.0))
}

fn package_scripts_for_confirmation(workspace_root: &std::path::Path) -> Vec<(String, String)> {
    let package_json = workspace_root.join("package.json");
    let Ok(content) = fs::read_to_string(package_json) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Vec::new();
    };
    let Some(scripts) = value.get("scripts").and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };

    scripts
        .iter()
        .filter_map(|(name, command)| {
            command
                .as_str()
                .map(|command| (name.clone(), command.to_string()))
        })
        .collect()
}

fn append_run_messages(run_id: &str, messages: Vec<AgentRunMessage>) -> Result<(), String> {
    if messages.is_empty() {
        return Ok(());
    }

    let mut guard = run_messages().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent run message 状态锁定失败，请稍后重试。",
        )
    })?;
    let entries = guard.entry(run_id.to_string()).or_default();

    entries.extend(messages);
    Ok(())
}

#[cfg(test)]
pub fn list_run_messages_for_test(run_id: &str) -> Vec<AgentRunMessage> {
    run_messages()
        .lock()
        .map(|guard| guard.get(run_id).cloned().unwrap_or_default())
        .unwrap_or_default()
}

pub fn list_step_tool_result_messages(
    run_id: &str,
    step_id: &str,
) -> Vec<crate::ai_agent::tool_loop::AgentToolResultMessage> {
    run_messages()
        .lock()
        .map(|guard| {
            guard
                .get(run_id)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|message| match message {
                    AgentRunMessage::ToolResult(result) if result.step_id == step_id => {
                        Some(result)
                    }
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn lock_runs() -> Result<std::sync::MutexGuard<'static, HashMap<String, AiAgentRunPayload>>, String>
{
    runs().lock().map_err(|_| {
        errors::error(
            "AI_AGENT_RUN_FAILED",
            "Agent run 状态锁定失败，请稍后重试。",
        )
    })
}

fn get_run_mut<'a>(
    guard: &'a mut HashMap<String, AiAgentRunPayload>,
    run_id: &str,
) -> Result<&'a mut AiAgentRunPayload, String> {
    guard
        .get_mut(run_id.trim())
        .ok_or_else(|| errors::error("AI_AGENT_STEP_NOT_FOUND", "未找到指定 Agent run。"))
}

fn reset_steps(mut steps: Vec<AiTaskPlanStepPayload>) -> Vec<AiTaskPlanStepPayload> {
    for (index, step) in steps.iter_mut().enumerate() {
        step.index = index;
        step.status = "pending".to_string();
        step.is_active = None;
    }

    steps
}

fn resolve_step_index(run: &AiAgentRunPayload, step_id: Option<&str>) -> Result<usize, String> {
    if let Some(step_id) = step_id {
        let trimmed = step_id.trim();
        return run
            .steps
            .iter()
            .position(|step| step.id == trimmed)
            .ok_or_else(|| errors::error("AI_AGENT_STEP_NOT_FOUND", "未找到指定 Agent step。"));
    }

    run.steps
        .iter()
        .position(|step| step.status == "running")
        .or_else(|| run.steps.iter().position(|step| step.status == "pending"))
        .ok_or_else(|| errors::error("AI_AGENT_STEP_NOT_FOUND", "没有可继续执行的 Agent step。"))
}

#[cfg(test)]
mod tests {
    use crate::ai_agent::planner::AgentPlanner;
    use crate::ai_agent::runtime;
    use crate::commands::contracts::{
        AiAgentPlanRequest, AiAgentRunPlanRequest, AiAgentRunStepRequest,
        AiAgentSetNetworkPermissionRequest,
    };

    #[test]
    fn run_step_advances_pending_to_running_then_done() {
        let plan = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "实现 Step Runtime".to_string(),
            context: Vec::new(),
        })
        .expect("plan should be created");

        let created = runtime::run_plan(AiAgentRunPlanRequest {
            goal: "实现 Step Runtime".to_string(),
            steps: plan.steps,
            context: Vec::new(),
        })
        .expect("run should be created");
        let run_id = created.run.id;

        let running = runtime::run_step(AiAgentRunStepRequest {
            run_id: run_id.clone(),
            step_id: None,
            skip_tool_execution: false,
        })
        .expect("step should start");

        assert_eq!(running.run.status, "running-step");
        assert_eq!(running.run.steps[0].status, "running");

        let done = runtime::run_step(AiAgentRunStepRequest {
            run_id,
            step_id: None,
            skip_tool_execution: false,
        })
        .expect("step should complete");

        assert_eq!(done.run.status, "running-plan");
        assert_eq!(done.run.steps[0].status, "done");
    }

    #[test]
    fn completed_step_appends_ref_only_tool_result_messages() {
        let plan = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "记录工具结果".to_string(),
            context: Vec::new(),
        })
        .expect("plan should be created");

        let created = runtime::run_plan(AiAgentRunPlanRequest {
            goal: "记录工具结果".to_string(),
            steps: plan.steps,
            context: Vec::new(),
        })
        .expect("run should be created");
        let run_id = created.run.id;

        runtime::run_step(AiAgentRunStepRequest {
            run_id: run_id.clone(),
            step_id: None,
            skip_tool_execution: false,
        })
        .expect("step should start");
        runtime::run_step(AiAgentRunStepRequest {
            run_id: run_id.clone(),
            step_id: None,
            skip_tool_execution: false,
        })
        .expect("step should complete");

        let messages = runtime::list_run_messages_for_test(&run_id);

        assert!(!messages.is_empty());
        assert!(format!("{messages:?}").contains("ToolResult"));
        assert!(!format!("{messages:?}").contains("```"));
    }

    #[test]
    fn skipped_step_tool_execution_only_updates_step_state() {
        let plan = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "Provider loop 已单独执行工具".to_string(),
            context: Vec::new(),
        })
        .expect("plan should be created");

        let created = runtime::run_plan(AiAgentRunPlanRequest {
            goal: "Provider loop 已单独执行工具".to_string(),
            steps: plan.steps,
            context: Vec::new(),
        })
        .expect("run should be created");
        let run_id = created.run.id;

        runtime::run_step(AiAgentRunStepRequest {
            run_id: run_id.clone(),
            step_id: None,
            skip_tool_execution: false,
        })
        .expect("step should start");
        let done = runtime::run_step(AiAgentRunStepRequest {
            run_id: run_id.clone(),
            step_id: None,
            skip_tool_execution: true,
        })
        .expect("step should complete without legacy tool execution");

        let messages = runtime::list_run_messages_for_test(&run_id);

        assert_eq!(done.run.steps[0].status, "done");
        assert!(messages.is_empty());
    }

    #[test]
    fn network_permission_requires_explicit_allowed_state() {
        runtime::set_network_permission(AiAgentSetNetworkPermissionRequest {
            permission: "ask".to_string(),
        })
        .expect("ask permission should be valid");
        assert!(runtime::ensure_network_allowed().is_err());

        let allowed = runtime::set_network_permission(AiAgentSetNetworkPermissionRequest {
            permission: "allowed-this-run".to_string(),
        })
        .expect("allowed permission should be valid");
        assert_eq!(allowed.permission, "allowed-this-run");
        assert!(runtime::ensure_network_allowed().is_ok());

        runtime::set_network_permission(AiAgentSetNetworkPermissionRequest {
            permission: "ask".to_string(),
        })
        .expect("permission should reset for other tests");
    }
}
