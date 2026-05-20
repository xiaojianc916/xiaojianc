# ADR-20260520: MCP hooks 与 ai-mcp capability

## 状态

`proposed`

## 背景

仓库根目录存在 `hooks_mcp.yaml`，用于暴露类型检查、测试、构建与静态守卫脚本给 MCP server。AI sidecar 可调用 MCP 工具，因此 MCP 调用必须纳入 Rust capability 与 approval 边界。

## 决策

- `hooks_mcp.yaml` 是仓库级开发工具 MCP 配置，加载时机由外部 MCP host 决定；应用运行时不得把它作为用户可见能力自动启用。
- 新增 `src-tauri/capabilities/ai-mcp.json`，作为 MCP 工具调用的独立 capability 域。
- sidecar 后续调用 MCP 工具前 MUST 通过 Rust 申请 capability / approval token；token 失败或超时必须中止调用。
- MCP server URL、server 名和工具 allow-list 后续 MUST 由 Rust 权威配置下发，sidecar 不得硬编码可变安全策略。

## 影响

本 ADR 只登记配置用途与 capability 域，不改变现有 MCP 调用实现。后续迁移 `agent-sidecar/src/tools/mcp*.ts` 时，以本 ADR 为安全边界依据。
