# ADR-006: commit / stage / unstage / discard 必须走 Git CLI

**状态**：Accepted  
**日期**：2026-05-25  
**决策者**：@com.xiaojianc

## Context

项目已将 libgit2 替换为 gix（纯 Rust Git 实现），实现了零 C 依赖的仓库打开 / 引用读取 / 对象查询。但以下 POSIX/用户级 Git 语义仅 Git CLI 完整实现，gix 明确不覆盖：

| 机制 | gix 支持 | 绕过后果 |
|------|----------|----------|
| `pre-commit` hook | ❌ | 未经 lint / test 的提交进入历史 |
| `commit-msg` hook | ❌ | commit message 模板校验被跳过 |
| `post-commit` hook | ❌ | 通知 / CI trigger 静默丢失 |
| `commit.gpgsign` | ❌ | 签名承诺损坏 |
| `commit.template` | ❌ | 团队约定格式被绕过 |
| `commit.verbose` | ❌ | diff 缺失降低 review 效率 |
| `core.hooksPath` | ❌ | 集中式 hook 管理失效 |
| `merge.ff` / `pull.ff` | ❌ | fast-forward 策略不一致 |
| `rebase.autosquash` | ❌ | fixup/squash 自动编排丢失 |

这不是"功能缺位待补"——gix 的设计目标是有意不覆盖这些用户级语义，交由上层工具（Git CLI、libgit2 porcelain）处理。

## Decision

**commit / stage / unstage / discard 四类操作强制走 Git CLI，不迁入 gix。**

理由：
1. 上述 hook / 签名 / 模板机制是用户与 Git 仓库之间的契约，绕过即破坏用户预期
2. gix 不是功能缺位，是设计边界——它负责对象存储和引用操作，不负责用户级语义
3. 项目使用 gix 的核心收益（零 C 依赖 + 纯 Rust 仓库读取）已经实现，不影响这四个 porcelain 操作

## Consequences

- **`git.exe` 是设计依赖，不是临时兜底**。未来任何人想"优化掉 CLI 调用"时，grep 到这份 ADR 应停手
- 6 个 `commands/git/*.rs` 通过统一的 `cli` 模块（`commands/git/cli.rs`）调用 CLI，避免了 6 份重复的子进程封装
- 如需在"未安装 git"的环境运行：仓库打开 / 历史查询 / 分支列出 / PR 支持可以工作；commit / stage / discard 会明确报错"未找到 git 可执行文件"

## Alternatives Considered

- **全迁 gix**：绕过用户 hook/GPG 配置，破坏性太大，否决
- **部分 gix + 特性检测**：先走 gix，出错回退 CLI——引入隐式行为差异，同一操作两次结果不同，否决
- **hook 自实现**：不是不可行，但相当于在项目内维护一个 mini-Git CLI，成本远超收益

## Related

- ADR-005：git2 → gix 迁移
- `src-tauri/src/commands/git/cli.rs`：统一子进程封装
- gix status / rev_walk 上游跟进见 `commands/git/status.rs` 和 `commands/git/history.rs` 中的 TODO 注释