use std::collections::HashSet;

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::ai_agent::policy::{
    classify_task as classify_by_policy, AgentTaskPolicyInput, MAX_PLAN_STEPS, MIN_PLAN_STEPS,
};
use crate::ai_tools::registry;
use crate::commands::contracts::{
    AiAgentApprovePlanPayload, AiAgentApprovePlanRequest, AiAgentClassifyTaskPayload,
    AiAgentClassifyTaskRequest, AiAgentPlanPayload, AiAgentPlanRequest, AiContextReferencePayload,
    AiTaskPlanStepPayload,
};

pub struct AgentPlanner;

impl AgentPlanner {
    pub fn classify_task(
        payload: AiAgentClassifyTaskRequest,
    ) -> Result<AiAgentClassifyTaskPayload, String> {
        let goal = normalize_goal(&payload.goal)?;
        let decision = classify_by_policy(AgentTaskPolicyInput {
            goal,
            referenced_file_count: count_referenced_files(&payload.context),
        });

        Ok(AiAgentClassifyTaskPayload {
            classification: decision.classification.as_str().to_string(),
            should_enter_plan_mode: decision.should_enter_plan_mode,
            reason: decision.reason.to_string(),
        })
    }

    pub fn create_plan(payload: AiAgentPlanRequest) -> Result<AiAgentPlanPayload, String> {
        let goal = normalize_goal(&payload.goal)?;
        let decision = classify_by_policy(AgentTaskPolicyInput {
            goal,
            referenced_file_count: count_referenced_files(&payload.context),
        });

        let mut steps = if decision.should_enter_plan_mode {
            build_default_plan_steps(goal)
        } else {
            build_simple_plan_steps(goal)
        };

        normalize_plan_steps(&mut steps);
        validate_plan_steps(&steps)?;
        audit::emit(AiAuditEventKind::AgentPlanCreated);

        Ok(AiAgentPlanPayload { steps })
    }

    pub fn approve_plan(
        payload: AiAgentApprovePlanRequest,
    ) -> Result<AiAgentApprovePlanPayload, String> {
        let _goal = normalize_goal(&payload.goal)?;

        validate_plan_steps(&payload.steps)?;
        audit::emit(AiAuditEventKind::AgentPlanApproved);

        Ok(AiAgentApprovePlanPayload {
            approved_at: chrono::Utc::now().to_rfc3339(),
            step_count: payload.steps.len(),
        })
    }
}

fn normalize_goal(goal: &str) -> Result<&str, String> {
    let trimmed = goal.trim();

    if trimmed.is_empty() {
        return Err(errors::error("AI_AGENT_PLAN_INVALID", "任务目标不能为空。"));
    }

    Ok(trimmed)
}

fn count_referenced_files(context: &[AiContextReferencePayload]) -> usize {
    context
        .iter()
        .filter_map(|reference| reference.path.as_deref())
        .filter(|path| !path.trim().is_empty())
        .collect::<HashSet<_>>()
        .len()
}

fn normalize_plan_steps(steps: &mut [AiTaskPlanStepPayload]) {
    for (index, step) in steps.iter_mut().enumerate() {
        step.index = index;
        if step.id.trim().is_empty() || step.id.starts_with("plan-step-") {
            step.id = format!("plan-step-{}", index + 1);
        }
        step.status = "pending".to_string();
        step.is_active = None;
    }
}

pub(crate) fn validate_plan_steps(steps: &[AiTaskPlanStepPayload]) -> Result<(), String> {
    if steps.len() < MIN_PLAN_STEPS {
        return Err(errors::error(
            "AI_AGENT_PLAN_TOO_SHORT",
            "计划步骤数必须在 2 到 6 之间。",
        ));
    }

    if steps.len() > MAX_PLAN_STEPS {
        return Err(errors::error(
            "AI_AGENT_PLAN_TOO_LONG",
            "计划步骤数必须在 2 到 6 之间。",
        ));
    }

    for (index, step) in steps.iter().enumerate() {
        validate_plan_step(index, step)?;
    }

    Ok(())
}

fn validate_plan_step(index: usize, step: &AiTaskPlanStepPayload) -> Result<(), String> {
    if step.index != index {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤 index 必须按顺序排列。",
        ));
    }

    if step.title.trim().is_empty()
        || step.goal.trim().is_empty()
        || step.expected_output.trim().is_empty()
    {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤必须包含标题、目标与预期产物。",
        ));
    }

    if !matches!(
        step.kind.as_str(),
        "inspect" | "search" | "design" | "edit" | "verify" | "summarize"
    ) {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤 kind 不在允许范围内。",
        ));
    }

    if !matches!(
        step.status.as_str(),
        "pending" | "running" | "done" | "failed" | "skipped" | "cancelled"
    ) {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤 status 不在允许范围内。",
        ));
    }

    if !matches!(step.risk_level.as_str(), "low" | "medium" | "high") {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤 riskLevel 不在允许范围内。",
        ));
    }

    if step.tools.is_empty() {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "计划步骤必须声明至少一个已注册工具。",
        ));
    }

    for tool_name in &step.tools {
        if !registry::is_tool_registered(tool_name) {
            return Err(errors::error(
                "AI_AGENT_TOOL_NOT_ALLOWED",
                "计划包含未注册工具，已拒绝批准。",
            ));
        }
    }

    Ok(())
}

fn build_default_plan_steps(goal: &str) -> Vec<AiTaskPlanStepPayload> {
    vec![
        build_step(
            0,
            "收集现有上下文与影响面",
            &format!("围绕“{}”读取当前文件、诊断与项目搜索结果", goal),
            "inspect",
            "low",
            vec!["search_text", "read_current_file", "get_diagnostics"],
            false,
            "产出受影响文件、相关符号与边界说明",
            Some("只读步骤无需回滚"),
        ),
        build_step(
            1,
            "设计实现方案与风险控制",
            &format!("为“{}”确定最小改动路径与验证方式", goal),
            "design",
            "medium",
            vec!["search_symbols", "get_git_diff"],
            false,
            "产出可执行方案、风险点与验证方式",
            Some("只读步骤无需回滚"),
        ),
        build_step(
            2,
            "生成改动并执行最小验证",
            &format!("按批准后的计划处理“{}”，并保留 AED 回滚入口", goal),
            "verify",
            "medium",
            vec!["propose_patch", "get_diagnostics", "get_git_diff"],
            true,
            "输出改动结果、验证结论与后续建议",
            Some("通过 AED 时间线回滚本轮写盘"),
        ),
    ]
}

fn build_simple_plan_steps(goal: &str) -> Vec<AiTaskPlanStepPayload> {
    vec![
        build_step(
            0,
            "确认当前请求",
            &format!("读取与“{}”相关的最小上下文", goal),
            "inspect",
            "low",
            vec!["read_current_file"],
            false,
            "给出可执行结论所需的最小上下文",
            Some("只读步骤无需回滚"),
        ),
        build_step(
            1,
            "输出结果摘要",
            &format!("基于已收集上下文回答“{}”", goal),
            "summarize",
            "low",
            vec!["get_diagnostics"],
            false,
            "输出简要结论与必要的后续建议",
            Some("无需回滚"),
        ),
    ]
}

fn build_step(
    index: usize,
    title: &str,
    goal: &str,
    kind: &str,
    risk_level: &str,
    tools: Vec<&str>,
    requires_user_approval: bool,
    expected_output: &str,
    rollback_strategy: Option<&str>,
) -> AiTaskPlanStepPayload {
    AiTaskPlanStepPayload {
        id: format!("plan-step-{}", index + 1),
        index,
        title: title.to_string(),
        goal: goal.to_string(),
        kind: kind.to_string(),
        status: "pending".to_string(),
        expected_output: expected_output.to_string(),
        tools: tools.into_iter().map(|item| item.to_string()).collect(),
        tool_inputs: None,
        references: None,
        is_active: None,
        requires_user_approval,
        risk_level: risk_level.to_string(),
        rollback_strategy: rollback_strategy.map(|item| item.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::AgentPlanner;
    use crate::commands::contracts::{
        AiAgentApprovePlanRequest, AiAgentClassifyTaskRequest, AiAgentPlanRequest,
        AiContextReferencePayload,
    };

    fn file_reference(path: &str) -> AiContextReferencePayload {
        AiContextReferencePayload {
            id: format!("ref-{path}"),
            kind: "file".to_string(),
            label: path.to_string(),
            path: Some(path.to_string()),
            range: None,
            content_preview: String::new(),
            redacted: false,
        }
    }

    #[test]
    fn creates_complex_plan_with_two_to_six_steps() {
        let payload = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "接入 Agent Plan Mode".to_string(),
            context: Vec::new(),
        })
        .expect("plan should be created");

        assert!((2..=6).contains(&payload.steps.len()));
        assert_eq!(payload.steps[0].index, 0);
        assert!(payload.steps.iter().all(|step| step.status == "pending"));
    }

    #[test]
    fn classifies_more_than_two_files_as_complex() {
        let payload = AgentPlanner::classify_task(AiAgentClassifyTaskRequest {
            goal: "调整样式".to_string(),
            context: vec![
                file_reference("src/a.ts"),
                file_reference("src/b.ts"),
                file_reference("src/c.ts"),
            ],
        })
        .expect("classification should succeed");

        assert_eq!(payload.classification, "complex");
        assert!(payload.should_enter_plan_mode);
    }

    #[test]
    fn rejects_plan_with_unknown_tool() {
        let mut plan = AgentPlanner::create_plan(AiAgentPlanRequest {
            goal: "实现计划模式".to_string(),
            context: Vec::new(),
        })
        .expect("plan should be created");
        plan.steps[0].tools = vec!["unknown_tool".to_string()];

        let error = AgentPlanner::approve_plan(AiAgentApprovePlanRequest {
            goal: "实现计划模式".to_string(),
            steps: plan.steps,
        })
        .expect_err("unknown tool should be rejected");

        assert!(error.contains("AI_AGENT_TOOL_NOT_ALLOWED"));
    }
}
