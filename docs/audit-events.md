# 审计事件清单

> 按 R-14.5.3：审计事件清单 MUST 维护于本文件。
> 审计日志与运行日志分离存储，保留 ≥180 天，仅安全/运维可读。

---

## 格式

```
| 事件名 | 触发条件 | 关键字段 | 审计级别 |
```

---

## git 域

| 事件名 | 触发条件 | 关键字段 | 级别 |
|---|---|---|---|
| `git.commit` | 用户执行提交 | `traceId`, `message_length`, `staged_count`, `workspace_path` | HIGH |
| `git.stage` | 暂存文件 | `traceId`, `file_count`, `workspace_path` | MEDIUM |
| `git.unstage` | 取消暂存 | `traceId`, `file_count` | MEDIUM |

---

## 设置/配置域

| 事件名 | 触发条件 | 关键字段 | 级别 |
|---|---|---|---|
| `settings.workspace_changed` | 工作区根路径变更 | `traceId`, `new_path_hash` | HIGH |
| `settings.theme_changed` | 主题切换 | `traceId`, `from_mode`, `to_mode` | LOW |
| `ai.edit.auth_changed` | AED 授权等级升级或降级 | `traceId`, `from_level`, `to_level`, `task_id` | HIGH |
| `ai.edit.applied` | AED 自动写盘或用户确认后的 Patch 成功写入 | `traceId`, `task_id`, `turn_id`, `file_count`, `byte_size_total` | HIGH |
| `ai.edit.checkpoint_created` | 用户创建 AED 手动 checkpoint | `traceId`, `snapshot_id`, `task_id`, `file_count`, `label` | HIGH |
| `ai.edit.operation_reverted` | 用户撤销单条 AED 编辑 | `traceId`, `operation_id`, `source_snapshot_id`, `pre_revert_snapshot_id`, `restored_snapshot_id`, `task_id`, `restored_file_count` | HIGH |
| `ai.edit.file_reverted` | 用户按文件回滚当前任务中的 AED 编辑 | `traceId`, `operation_id`, `task_id`, `path`, `pre_revert_snapshot_id`, `restored_snapshot_id`, `restored_file_count`, `granularity` | HIGH |
| `ai.edit.hunk_reverted` | 用户按 hunk 回滚当前文件中的 AED 编辑片段 | `traceId`, `operation_id`, `task_id`, `path`, `hunk_index`, `pre_revert_snapshot_id`, `restored_snapshot_id`, `granularity` | HIGH |
| `ai.edit.pruned` | AED retention 自动清理超出保留窗口的本地历史 | `traceId`, `pruned_operation_count`, `pruned_snapshot_count`, `pruned_blob_count`, `reclaimed_bytes`, `retained_operation_limit`, `retained_snapshot_limit` | HIGH |
| `ai.edit.task_reverted` | 用户按任务回滚当前任务内全部有效 AED 编辑 | `traceId`, `task_id`, `reverted_operation_count`, `restored_file_count` | HIGH |
| `ai.edit.snapshot_restored` | 用户恢复 AED 快照 | `traceId`, `snapshot_id`, `pre_revert_snapshot_id`, `restored_snapshot_id`, `task_id`, `restored_file_count` | HIGH |
| `ai.agent.plan.created` | Agent 生成计划 | `traceId`, `goal_hash`, `step_count`, `classification` | HIGH |
| `ai.agent.plan.approved` | 用户批准 Agent 计划 | `traceId`, `goal_hash`, `step_count`, `approved_at` | HIGH |
| `ai.agent.permission.changed` | Agent 权限等级变化（standard/elevated） | `traceId`, `from_level`, `to_level`, `scope` | HIGH |

---

## 窗口/会话域

| 事件名 | 触发条件 | 关键字段 | 级别 |
|---|---|---|---|
| `app.startup` | 应用启动 | `traceId`, `version`, `platform` | MEDIUM |
| `app.shutdown` | 应用退出（正常）| `traceId`, `session_duration_s` | MEDIUM |
| `terminal.session_create` | PTY 会话创建 | `traceId`, `session_id` | MEDIUM |
| `terminal.session_close` | PTY 会话关闭 | `traceId`, `session_id`, `exit_code` | MEDIUM |

---

> 新增高权限操作 MUST 在同一 PR 内将审计事件补充到本表。
