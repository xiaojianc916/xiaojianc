# 环境变量清单

> 按 R-13.5.4：环境变量清单 MUST 在此登记；未登记 MUST NOT 使用。
> 按 R-4.3.2：VITE_* 变量 MUST 在 `src/types/env.d.ts` 同步声明。

---

## 变量清单

| 变量名 | 类型 | 默认值 | 环境 | 描述 | 登记人 |
|---|---|---|---|---|---|
| AGENT_MCP_UVX_PATH | string | 自动探测 | dev/staging/prod | Windows 下 uvx.exe 绝对路径，供 `git/time/hooks/sqlite` MCP 启动 | Copilot |
| AGENT_MCP_GIT_EXECUTABLE_PATH | string | 自动探测 | dev/staging/prod | Windows 下 git.exe 绝对路径，供 Git MCP 绑定 `GIT_PYTHON_GIT_EXECUTABLE` | Copilot |
| AGENT_MCP_MEMORY_FILE_PATH | string | `%USERPROFILE%/.xiaojianc/mcp-memory.jsonl` | dev/staging/prod | memory MCP 持久化文件路径 | Copilot |
| AGENT_MCP_LOCAL_TIMEZONE | string | Asia/Shanghai | dev/staging/prod | time MCP 本地时区参数 | Copilot |
| AGENT_SIDECAR_MODEL | string | `deepseek/deepseek-v4-flash` | dev/staging/prod | Node sidecar 主 Agent 的默认模型标识 | Codex |
| AGENT_SIDECAR_API_KEY | string(secret) | - | dev/staging/prod | Node sidecar 调用主模型与后台记忆模型时使用的 API Key | Codex |
| AGENT_SIDECAR_BASE_URL | string | provider 默认值 | dev/staging/prod | Node sidecar 主模型与后台记忆模型共用的可选 Base URL | Codex |
| AGENT_SIDECAR_OBSERVER_MODEL | string | 按主模型 provider 自动降级到小模型 | dev/staging/prod | Observational Memory 中 Observer 后台 agent 的模型标识覆盖项 | Codex |
| AGENT_SIDECAR_REFLECTOR_MODEL | string | 按主模型 provider 自动降级到小模型 | dev/staging/prod | Observational Memory 中 Reflector 后台 agent 的模型标识覆盖项 | Codex |
| AGENT_SIDECAR_MEMORY_LAST_MESSAGES | string(number) | 6 | dev/staging/prod | Mastra memory 回放到模型的最近消息条数，范围 2-12 | Codex |
| AGENT_SIDECAR_MEMORY_EMBEDDER_MODEL | string | - | dev/staging/prod | 开启 semantic recall 时使用的 embedding 模型标识 | Codex |
| AGENT_SIDECAR_MEMORY_ENABLE_SEMANTIC_RECALL | string(boolean) | 自动（配置 embedder 时开启） | dev/staging/prod | 显式控制 semantic recall 开关；设为 falsy 时关闭 | Codex |
| AGENT_SIDECAR_MEMORY_ENABLE_OBSERVATIONAL | string(boolean) | true | dev/staging/prod | Observational Memory 总开关；默认开启，设为 falsy 时关闭 | Codex |
| AGENT_SIDECAR_MEMORY_ENABLE_OBSERVATIONAL_BUFFERING | string(boolean) | false | dev/staging/prod | 是否启用 Observational Memory 的异步 buffering | Codex |
| GITHUB_MCP_PAT | string(secret) | - | dev/staging/prod | GitHub MCP Server 访问令牌（Bearer） | Copilot |
| GITHUB_MCP_URL | string | https://api.githubcopilot.com/mcp/ | dev/staging/prod | GitHub MCP Server Streamable HTTP 地址 | Copilot |
| SQLITE_DB_PATH | string | - | dev/staging/prod | sqlite-mcp 连接的本地数据库绝对/相对路径 | Copilot |
| SQLITE_READ_ONLY | string(boolean) | true | dev/staging/prod | sqlite-mcp 只读模式开关 | Copilot |
| SQLITE_TIMEOUT | string(number) | 30 | dev/staging/prod | sqlite-mcp 查询超时秒数 | Copilot |
| TAVILY_API_KEY | string(secret) | - | dev/staging/prod | Tavily MCP 的 API Key | Copilot |

---

## 说明

- 所有 `VITE_*` 变量 **会** 打入前端产物，MUST NOT 含密钥/令牌/内部地址
- 非 `VITE_` 前缀的变量仅 Node 构建脚本可读，不进产物
- 密钥/凭证 MUST NOT 在此登记，MUST 存 CI Secret 或 Tauri stronghold
- ADR-20260422-window-resize-tearing 已审阅确认：本方案不新增环境变量

---

## 变量模板示例

```
VITE_APP_VERSION     = 1.0.0        # 应用版本展示
VITE_DEV_SERVER_PORT = 1420         # 开发服务器端口（仅 dev）
```

---

> 新增环境变量 MUST 在同一 PR 内同步更新本文件 + `src/types/env.d.ts`。
