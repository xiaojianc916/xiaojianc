# ADR-20260429 Agent Plan Mode 与可审计网络工具

- **日期**：2026-04-29
- **状态**：`proposed`
- **决策者**：待 Code Owner 确认
- **关联**：ADR-20260427 通用 IDE AI 子系统、ADR-20260428 Agent 自动编辑与可回滚体系

---

## 背景

AED 已经提供“用户授权后自动写盘 + 可回滚”的安全底座，但当前 Agent 仍主要表现为聊天或前端 PoC 工具循环。复杂任务缺少可审阅计划、逐步执行状态、工具可见性、来源引用和失败恢复入口。

因此需要把 Agent 升级为 Plan-first IDE 工作流执行器：复杂任务先计划，用户批准后再运行；联网、写盘、命令、Git 等能力必须经过统一工具注册表、权限门控、审计和 UI activity。

## 决策

1. **复杂任务必须先 Plan**
   - 复杂任务生成 2~6 个计划步骤。
   - 每个步骤必须包含标题、目标、预期产物、工具、风险等级和回滚策略。
   - 未批准计划前不得写盘。

2. **Tool Registry 是工具名单 SSoT**
   - Plan step 的 `tools` 只能引用已注册工具。
   - 未知工具名必须拒绝，不能由模型字符串动态生成工具入口。
   - 第一阶段继续复用现有 `src-tauri/src/ai_tools/registry.rs`。

3. **网络能力是工具，不是自由浏览器**
   - 后续 `web_search` / `web_fetch` 必须显示 query、经过 redaction、可审计、可取消。
   - `web_fetch` 禁止访问 localhost、内网、`file://`。
   - 网页正文不得进入 Pinia，必须 ref 化。

4. **写盘继续走 AED**
   - Agent 写盘必须经 `propose_patch → AED apply → timeline → rollback`。
   - 不允许模型直接覆盖文件。
   - Patch 冲突必须停步，不得整文件覆盖兜底。

5. **Phase 0 / Phase 1 收敛**
   - 当前阶段先完成类型、schema、IPC 合同、Rust planner / policy、Plan UI 与批准闭环。
   - 真正 `run_plan` / `run_step` / Web Sources / Diff Timeline 分别进入后续阶段，避免双 runtime。

## 影响

- 前端新增 `src/types/ai-agent.ts`、`src/types/ai-agent.schema.ts`、`src/store/aiAgent.ts`、`useAiAgentPlan` 与 Plan UI 组件作为计划模式事实源。
- Rust 侧把任务分类、计划生成、计划批准收口到 `src-tauri/src/ai_agent/planner.rs` 与 `policy.rs`。
- `gateway.rs` 只保留入口分发，不再承载 Plan 业务规则。
- 审计事件登记到 `docs/audit-events.md`，但事件内容不得包含 prompt 原文、代码全文、网页全文或完整 patch。

## 回滚方案

- 关闭 Agent 模式即可退回普通 Chat。
- Plan Mode 仅生成和批准计划，不写盘；若后续执行写盘，仍由 AED 提供回滚。
- 若 planner / policy 规则误判，可在 Rust 策略层回退为简单任务直接执行。

## 验收

- 复杂任务自动进入 Plan Mode。
- Plan 步数稳定在 2~6。
- 未注册工具名无法通过计划批准。
- 用户可编辑、删除、重生成并批准计划。
- 本阶段不暴露假的 Web Sources、Run Timeline 或 Revert 操作。
