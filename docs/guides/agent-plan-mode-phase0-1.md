# Agent Plan Mode Phase 0 / Phase 1 实施清单

- 日期：2026-04-29
- 状态：draft
- 适用范围：仅覆盖 Plan Mode 大方案的 Phase 0 与 Phase 1
- 前置条件：AED 已完成并保持可用，参见 docs/architecture/ADR-20260428-agent-auto-edit-and-rollback.md

---

## 目标

把“大而全”的 Agent Plan Mode + Web Search 方案压成当前仓库可以立即开工的两段：

- **Phase 0**：冻结契约与边界，不做假功能。
- **Phase 1**：做出可用的 Plan Mode 最小闭环，但**不提前暴露真正的 Step Runtime**。

这份清单的作用不是重复产品方案，而是回答三件事：

1. 现在应该先改哪些现有文件。
2. 现在应该新增哪些最小文件。
3. 哪些文件名虽然在大方案里出现了，但当前阶段**先不要建**。

---

## 当前锚点

以下事实已经在仓库中成立，Phase 0 / 1 必须以这些文件为锚点推进，而不是另起一套并行实现：

| 领域 | 当前锚点 | 现状判断 |
|---|---|---|
| AED 写盘与回滚 | src-tauri/src/ai_patch/mod.rs、src-tauri/src/ai_edit/ | 已可复用，后续 Agent 写盘必须继续走这条链路 |
| AI 命令入口 | src-tauri/src/commands/ai.rs | 当前 AI IPC 已集中在这里，Phase 0 / 1 不要平地再建 commands/ai_agent.rs |
| AI Provider / Gateway | src-tauri/src/ai/gateway.rs | ai_plan_task 仍为空实现，需要在现有 gateway 上补全 |
| Agent Rust 目录 | src-tauri/src/ai_agent/ | 目录已存在，但 runtime / planner / step 仍是占位状态 |
| 工具注册表 | src-tauri/src/ai_tools/registry.rs | 只有 Phase 0 白名单，尚无 network / git / command 权限层 |
| 前端 Agent PoC | src/composables/useAiAssistant.ts | 当前 tool loop 主要在前端，需要逐步下沉，不能继续膨胀 |
| 计划 UI | src/components/business/ai/AiTaskPlan.vue | 仅有极简列表，不足以承载 Plan Mode |
| AI 服务入口 | src/services/modules/ai.ts、src/services/tauri.ts、src/services/tauri.contracts.ts | 现有调用面可扩展，不要急着拆出一整套新 service 模块 |

---

## 与原大方案的两处收敛

为避免在当前仓库里制造“双实现”或“假入口”，Phase 0 / 1 先做两处收敛：

### 收敛 1：Phase 1 不提前放出真正的 Run Timeline

原方案把 Approve & Run 放在 Phase 1，但当前真正的 step runtime 还没有从前端 PoC 下沉到 Rust。若现在提前做 Run Timeline，会同时维护：

- 前端内嵌 tool loop
- 未来 Rust run / step 状态机

这会直接制造双事实源。当前建议是：

- **Phase 1 交付到“生成计划 → 编辑计划 → 批准计划”闭环。**
- 批准后的真正执行、暂停、恢复、重试、timeline，留到 Phase 2。

如果产品坚持要保留“Approve & Run”按钮，Phase 1 也只能做成“批准计划并进入待执行态”，不能做真实运行。

### 收敛 2：Phase 0 / 1 不做大规模文件名重排

原方案里有大量新文件名，例如：

- src/services/modules/ai-agent.ts
- src/services/modules/ai-context.ts
- src/services/modules/ai-tools.ts
- src-tauri/src/commands/ai_agent.rs
- src-tauri/src/commands/ai_tools.rs

这些拆分最终是需要的，但**不是当前第一刀**。Phase 0 / 1 应优先改现有入口，原因是：

- 现有 tauri IPC 和 AI service 已经稳定挂在 ai.ts / commands/ai.rs 上。
- 当前真正缺的是契约和状态机，而不是目录名。
- 先拆文件再补能力，只会增加 diff 面积和 review 成本。

---

## Phase 0：ADR 与契约基线

### Phase 0 目标

在不暴露新 UI 能力的前提下，先把 Agent Plan Mode 的事实源立住：

- 新 ADR
- 新类型
- 新 schema
- 新错误码
- 新审计事件名
- 新 IPC 合同占位

### Phase 0 DoD

- 仓库中出现独立的 Agent Plan 类型与 schema 文件。
- Plan step 支持 2~6 步约束和工具枚举校验。
- 前后端合同层已经知道 classify / create_plan / approve_plan 这些命令，但允许先返回受控占位结果。
- 审计事件与错误码名称完成单源登记。
- 不新增任何“看起来能运行、实际上不能运行”的 UI 入口。

### Phase 0 先改哪些现有文件

| 文件 | 改动 | 原因 |
|---|---|---|
| src/types/ai.ts | 逐步移除或改为 re-export 当前计划相关类型 | 避免继续把 agent 类型堆在通用 ai.ts 里 |
| src/types/ai.schema.ts | 逐步移除或改为引入新 agent schema | 保持 schema 单源 |
| src/types/ai-tools.ts | 把工具名收紧到受控枚举，并补 risk / permission 元数据 | 为后续 plan step.tools 做事实源 |
| src/types/tauri.ts | 增加新的 AI Agent IPC 方法签名 | 保持前端接口单源 |
| src/services/tauri.contracts.ts | 增加 classify / create_plan / approve_plan 合同 | 前端 IPC 必须先有 schema |
| src/services/tauri.ts | 暴露新的 AI Agent IPC 封装 | UI 不能直接 invoke |
| src/services/modules/ai.ts | 在现有 ai service 上补 Agent Plan 方法 | Phase 0 / 1 先复用现有 service 入口 |
| src-tauri/src/commands/contracts.rs | 增加 Agent Plan 请求 / 响应合同 | Rust 命令层单源契约 |
| src-tauri/src/commands/ai.rs | 注册新的 Agent Plan 命令 | 现阶段继续复用现有 AI 命令入口 |
| src-tauri/src/ai/gateway.rs | 把 ai_plan_task 空返回改成受控占位实现，或分发到 ai_agent/planner.rs | 当前真实入口就在这里 |
| src-tauri/src/ai/audit.rs | 增加 ai.agent.plan.*、ai.agent.permission.changed 等事件枚举 | 先登记事件名，后续再补字段 |
| docs/audit-events.md | 补 Agent Plan 相关事件 | 文档事实源必须同步 |

### Phase 0 现在应该新增的最小文件

| 新文件 | 用途 |
|---|---|
| docs/architecture/ADR-20260429-agent-plan-mode-web-search.md | 固化“Plan first + 可审计网络工具”的架构边界 |
| src/types/ai-agent.ts | Agent Plan / Run / Step / Permission 的独立类型单源 |
| src/types/ai-agent.schema.ts | Agent Plan / Run / Step / Permission 的 Zod schema |
| src/types/ai-agent.schema.spec.ts | 2~6 步限制、工具名枚举、权限字段校验的单测 |

### Phase 0 明确先不要建的文件

以下文件名虽然在完整方案里会出现，但当前阶段**先不要建**：

| 暂缓文件 | 暂缓原因 |
|---|---|
| src/services/modules/ai-agent.ts | 现有 src/services/modules/ai.ts 足够承接 Phase 0 / 1 |
| src/services/modules/ai-context.ts | 当前不做 Context Engine 重构 |
| src/services/modules/ai-tools.ts | 先收敛工具合同，不做模块拆分 |
| src/services/modules/ai-patch.ts | AED / patch 入口已经稳定，不要重复封装 |
| src/types/ai-stream.ts | 现在还没有新的 run / step stream 事件 |
| src/types/ai-patch.ts | 现有 patch 类型足够支持 Phase 0 / 1 |
| src-tauri/src/commands/ai_agent.rs | 当前命令入口仍在 commands/ai.rs |
| src-tauri/src/commands/ai_tools.rs | 当前不改命令目录边界 |
| src-tauri/src/commands/ai_patch.rs | 现有 ai_patch 模块已稳定 |
| src-tauri/src/ai_tools/web_search.rs | Web 能力属于 Phase 3 |
| src-tauri/src/ai_tools/web_fetch.rs | Web 能力属于 Phase 3 |
| src-tauri/src/ai_mcp/ | MCP 属于更后阶段 |

### Phase 0 验证

- vitest：新增 ai-agent.schema.spec.ts
- cargo test：覆盖 planner 合同最小行为
- pnpm typecheck
- pnpm lint

---

## Phase 1：Plan Mode 最小闭环

### Phase 1 目标

把当前“Agent 模式直接进前端 tool loop”的入口，改成“复杂任务先出计划”的最小闭环：

- classify task
- create plan
- Plan 面板
- 计划编辑 / 删除 / 重生成
- 批准计划

注意：Phase 1 **不做真正的 running-step / tool timeline / web sources / step retry**。

### Phase 1 DoD

- 复杂任务进入 Plan Mode。
- 计划步骤数稳定在 2~6。
- 用户可以编辑标题、删除步骤、重新生成计划。
- 用户可以批准计划。
- Agent 模式不再直接走现有前端内嵌 tool loop。
- UI 中不出现假的 web、timeline、revert 按钮。

### Phase 1 先改哪些现有文件

| 文件 | 改动 | 原因 |
|---|---|---|
| src/composables/useAiAssistant.ts | 切断当前 agent 模式直接执行 executeAgentRequest 的路径，改为 classify / plan flow | 当前最大的结构风险点就在这里 |
| src/components/business/ai/AiAssistantPanel.vue | 在输入框上方插入 Plan 面板容器，并显示 plan 状态 | 当前 AI 面板主容器已经存在 |
| src/components/business/ai/AiPromptInput.vue | 只做输入与触发，不把 Plan 交互塞进输入框内部逻辑 | 保持输入组件边界稳定 |
| src/components/business/ai/AiTaskPlan.vue | 不继续膨胀；要么退化成兼容壳，要么在新面板落地后移除引用 | 现有组件过于简化，不适合继续堆逻辑 |
| src/store/ai.ts | 只保留 Provider 配置职责，不要把 Agent Run 状态塞进来 | 避免已有 store 职责继续失控 |
| src/services/modules/ai.ts | 补 classify / create_plan / approve_plan 调用 | 现有 service 入口继续复用 |
| src/services/tauri.ts | 补新的 Agent Plan IPC | UI 仍然通过 service 调用 |
| src/services/tauri.contracts.ts | 补新的 Zod 合同 | 合同先行 |
| src-tauri/src/commands/ai.rs | 新增 classify / create_plan / approve_plan 命令导出 | 与现有 AI 命令同入口 |
| src-tauri/src/ai/gateway.rs | 把计划生成逻辑路由到 ai_agent/planner.rs | 现有 gateway 还是总入口 |
| src-tauri/src/ai_agent/planner.rs | 真正实现“复杂度判断 + 2~6 步计划产出” | Phase 1 的 Rust 核心文件 |
| src-tauri/src/ai_agent/policy.rs | 放置 must-enter-plan-mode 判定与 plan size 归一化规则 | 避免 planner.rs 既做规则又做模型交互 |

### Phase 1 现在应该新增的最小文件

| 新文件 | 用途 |
|---|---|
| src/store/aiAgent.ts | 只存 plan UI 元数据与当前 active plan，不存大文本 |
| src/composables/useAiAgentPlan.ts | 负责 classify / create / edit / approve 的前端编排 |
| src/components/business/ai/AiPlanModePanel.vue | 输入框上方的主 Plan 容器 |
| src/components/business/ai/AiPlanStepList.vue | 紧凑待办列表 |
| src/components/business/ai/AiPlanStepItem.vue | 单步展示与展开详情 |
| src/components/business/ai/AiPlanApprovalBar.vue | 批准、重生成、取消等操作条 |
| src/components/business/ai/AiPlanModePanel.spec.ts | 计划面板交互测试 |
| src/composables/useAiAgentPlan.spec.ts | classify / create / edit / approve 编排测试 |

### Phase 1 明确先不要建的文件

以下文件都属于真正运行态或联网能力，Phase 1 先不要建：

| 暂缓文件 | 暂缓原因 |
|---|---|
| src/components/business/ai/AiAgentRunTimeline.vue | 真正的 timeline 要等 Phase 2 step runtime |
| src/components/business/ai/AiToolCallCard.vue | 没有 step runtime 前会变成摆设 |
| src/components/business/ai/AiStepFailureActions.vue | 失败重试依赖 run / step 状态机 |
| src/components/business/ai/AiAgentRunSummary.vue | Summary 依赖实际执行数据 |
| src/components/business/ai/AiWebSearchPermissionDialog.vue | Web 能力未落地 |
| src/components/business/ai/AiWebSourcesPanel.vue | Web 能力未落地 |
| src/components/business/ai/AiWebSourceCard.vue | Web 能力未落地 |
| src/components/business/ai/AiChangedFilesSummary.vue | 直接写盘 summary 要等 Phase 4 |
| src/components/business/ai/AiDiffHunkViewer.vue | Diff hunk viewer 要等 patch.summary 事件 |
| src/components/business/ai/AiPatchApplyActivity.vue | 当前阶段不做真实执行态 |
| src/composables/useAiAgentRun.ts | Run 状态机留到 Phase 2 |
| src/composables/useAiAgentStream.ts | Run stream 留到 Phase 2 |
| src/composables/useAiAgentDiff.ts | Patch summary 留到 Phase 4 |
| src-tauri/src/ai_tools/web_search.rs | Phase 3 |
| src-tauri/src/ai_tools/web_fetch.rs | Phase 3 |
| src-tauri/src/ai_security/ | run_command 分级留到更后阶段 |

### Phase 1 推荐顺序

1. 先完成 Phase 0 的类型、schema、IPC 合同。
2. 在 Rust planner.rs / policy.rs 中补 must-enter-plan-mode 判定与 2~6 步归一化。
3. 在前端新增 aiAgent store 与 useAiAgentPlan.ts。
4. 在 AiAssistantPanel.vue 中插入 AiPlanModePanel.vue，并让 agent 模式改走计划流。
5. 让 AiTaskPlan.vue 停止扩容，统一收口到新面板。
6. 补前端交互单测与 Rust planner 单测。

### Phase 1 验证

- vitest：
  - src/composables/useAiAgentPlan.spec.ts
  - src/components/business/ai/AiPlanModePanel.spec.ts
  - 现有 src/composables/useAiAssistant.spec.ts 需要补“复杂任务不再直接执行工具”的断言
- cargo test：
  - ai_agent/planner.rs
  - ai_agent/policy.rs
- pnpm typecheck
- pnpm lint
- pnpm test

---

## Phase 0 / 1 之后才能开的能力

下列能力必须等后续阶段，当前不要提前混入：

- Phase 2：run_plan / run_step / pause / resume / cancel / timeline
- Phase 3：web_search / web_fetch / network permission / web sources
- Phase 4：patch summary / files changed / step revert / verify fail auto revert
- Phase 5：e2e-agent-plan / 文档收口 / 性能预算 / 发布门禁

---

## 开工顺序建议

如果从这份清单继续落地，建议严格按以下顺序提交：

1. ADR + 类型 + schema + 合同
2. planner / policy 最小 Rust 实现
3. aiAgent store + useAiAgentPlan.ts
4. Plan 面板 UI 接线
5. 单测补齐

这 5 步完成前，不建议开始 Web Search、MCP、Command Security、Patch Summary UI。