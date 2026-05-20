# ADR-20260520: AED 权威层归属

## 状态

`proposed`

## 背景

AED（Agent Edit Pipeline）横跨 Rust、Node sidecar 与前端。为避免同一概念在多进程中各自维护可变状态，本 ADR 固化权威层与同步方向。后续实现若需要偏离，必须新建 ADR 说明理由。

## 决策

| 概念 | 权威层 | 影子层（只读） | 同步方向 |
| --- | --- | --- | --- |
| Plan schema & policy | Rust `ai_agent` | sidecar、前端 | Rust → sidecar → 前端 |
| Plan runtime 执行 | Sidecar (Mastra workflow) | 前端展示 | sidecar → 前端 |
| Approval 决策 | Rust（待迁入 `approval_engine`） | 前端 UI 仅作输入 | 前端 → Rust，Rust → sidecar |
| Edit / Snapshot / Journal / Revert | Rust `ai_edit` | sidecar 仅转发 | 单向 Rust 持久化 |
| Stream 解析 | Sidecar `streaming/` | Rust 透传，前端展示 | sidecar → 前端 |
| Token 细粒度计数 | Sidecar `budget/` | Rust 持硬上限闸 | sidecar 上报，Rust 闸断 |
| Provider 元数据 | Rust `ai/provider.rs` | sidecar 启动握手时收只读副本 | Rust → sidecar |
| Credential | Rust `ai/credential.rs` | 无 | 仅 Rust |
| Audit log | Rust `ai/audit.rs` | 无 | 仅 Rust |
| Capability ACL | Rust `capabilities/*.json` | 无 | 仅 Rust |

## 约束

- 影子层 MUST NOT 持有可变权威状态，只能保存最后一次同步的快照。
- sidecar / 前端在权威快照同步失败时 MUST 进入降级只读模式。
- Approval、Credential、Audit、Capability ACL 的最终决策 MUST 留在 Rust。

## 影响

本 ADR 只记录权威边界，不直接迁移实现。Approval 权威迁移、MCP capability token、schema 生成链路应作为后续独立任务执行并单独验证。
