# router/index.ts — 当前状态：已启用（Active）

> **@status: active** | ADR: [ADR-20260423-welcome-smil-svg](../../docs/architecture/ADR-20260423-welcome-smil-svg.md)

## 当前用途

本项目当前保留最小路由壳，仅提供工作台启动锚点：

- `/home`：工作台路由锚点
- `App.vue` 负责全局宿主组件与运行时错误呈现

## 边界约束

- 路由 **不是** 工作台业务编排真源
- `ShellWorkbenchView.vue` 仍是唯一工作台页面
- 新增业务路由前，必须继续遵守 ADR 中的范围限制与评审要求
