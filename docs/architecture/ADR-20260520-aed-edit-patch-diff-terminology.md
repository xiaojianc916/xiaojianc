# ADR-20260520: AED edit / patch / diff 术语边界

## 状态

`proposed`

## 背景

AI 编辑链路同时出现 `edit`、`patch`、`diff` 三类命名。它们分别描述不同层级的概念，混用会导致职责错位：业务意图、字节变更和渲染呈现互相污染。

## 决策

| 术语 | 含义 | 归属 |
| --- | --- | --- |
| `edit` | 用户意图层，例如“把这一段改成 X”或“撤销某次 AI 编辑”。 | Rust `ai_edit` 权威持久化；前端只表达用户操作和视图状态。 |
| `patch` | 字节 / diff hunk 层，例如 unified diff、line number、文件内容变更。 | Rust 负责应用与校验；sidecar 与前端只能传递或预览。 |
| `diff` | 渲染呈现层，例如高亮、并排视图、行内增删样式。 | 前端组件与编辑器视图。 |

## 约束

- `edit` 命名 MUST 用于意图、任务、快照、回滚和持久化历史。
- `patch` 命名 MUST 用于具体文本变更、hunk、hash 校验和 apply 输入输出。
- `diff` 命名 MUST 用于渲染与展示，不得承载写盘或安全决策。
- 新增跨层字段时 MUST 按上表选择命名；无法判定时先写 ADR 或在任务说明中登记理由。

## 影响

后续整理 `src-tauri/src/ai_patch/`、前端 `ai-patch-*` / `ai-diff-*` 工具和编辑预览组件时，以本 ADR 为命名依据。现有历史 ADR 中提到的 `ai_patch` 作为历史上下文保留，不就地改写。
