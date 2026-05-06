---
status: yellow
owner: xiaojianc
updated: 2026-05-06
---

# WSL Link 成熟度

## 当前状态

`yellow`：架构与可靠性核心已落地，并完成 gRPC / QUIC 协议生成、连接管理骨架、WSL agent gRPC 服务实现、agent Noise 配置启动校验、agent 用户态分发命令计划、payload 执行器、显式确认安装 / 后台启动命令、Windows `AF_HYPERV` 地址 / GUID 解析、非阻塞 connect、tonic Channel connector、OpenSession 握手执行器、主通道握手探测命令、QUIC fallback 帧通道骨架、Noise_KKpsk2 安全帧包装、桌面 keyring 密钥材料接口和本机环境自检。当前阶段只允许提供状态机、退避、熔断、WAL outbox、hedged 策略、协议契约、keepalive 配置、传输 adapter 边界、agent 协议服务、agent 启动配置解析、agent 用户目录安装计划、分发命令规格、stdin payload 执行器、`install_wsl_link_agent` / `start_wsl_link_agent` 显式确认入口、`probe_wsl_link_primary` 握手探测入口、Windows Hyper-V socket 地址构造、connect timeout、tonic 自定义 connector、OpenSession 请求/响应校验、QUIC bi-stream 请求/响应处理、Noise 加密帧处理、密钥材料生成 / 桌面侧存储和只读环境探测，不得替换现有终端生产链路。

## 关键缺口

- Windows `AF_HYPERV` 主通道已完成 Service GUID 映射、`SOCKADDR_HV` 构造、VM GUID 文本解析、`hcsdiag list` 输出解析、WinSock socket 创建、非阻塞 connect、timeout、Tokio stream 转换、tonic Channel connector，以及 OpenSession 请求/响应校验和执行器；`probe_wsl_link_primary` 会实际发起主通道握手并将 runtime 状态推进到 Ready 或 Backoff。尚未完成真实 WSL2 agent 握手矩阵和生产切流。
- Linux WSL agent 已新增 `src/bin/wsl_link_agent.rs` 入口、`OpenSession / ResumeSession / Heartbeat / Duplex` 服务实现，以及默认配置路径 / 环境变量 / `--noise-config` 启动解析；桌面侧已补用户态分发计划，使用 `~/.local/share/calamex/wsl-link` 与 `~/.config/calamex/wsl-link`，支持 prepare / 写 agent binary / 写 Noise config / verify / 后台 start 的 `wsl.exe -- sh -lc` 命令规格、stdin payload 执行器、`install_wsl_link_agent` 显式确认入口和 `start_wsl_link_agent` 后台启动入口。该入口依赖 `CALAMEX_WSL_LINK_AGENT_BINARY` 或应用旁路 Linux agent artifact，全部步骤成功后才保存桌面 keyring；尚未在 WSL2 真机内完成 `AF_VSOCK` listener 运行验证，也未接 UI 安装按钮。
- mirrored networking QUIC fallback 已完成长度前缀 + Prost 帧编解码、`quinn` bi-stream 请求/响应包装、connection / endpoint 服务循环骨架，以及 `Noise_KKpsk2_25519_ChaChaPoly_BLAKE2s` 加密帧包装；Noise 生命周期已完成成对材料生成、桌面侧 keyring 存储接口、版本化 JSON 编码、agent 配置解析、Linux 0600 权限校验、agent 私钥不落桌面侧存储校验，以及 agent 配置目录 / 文件安全写入计划；尚未完成 WSL 分发脚本、endpoint TLS 配置分发、真实握手矩阵和真机切流。
- `check_wsl_link_environment` 已提供只读自检，覆盖 WSL 版本、默认发行版、发行版列表、`vmcompute` 服务和用户级 `.wslconfig` mirrored networking 配置；`probe_wsl_link_primary` 已提供真实握手探测。尚未接入 UI 状态面板和真机矩阵记录。
- UI 安装入口、真机握手矩阵、指标面板和 E2E 断线恢复测试尚未完成。

## 升级条件

- P2 主备传输均通过真机矩阵。
- P3 终端 / 脚本执行可通过 feature flag 切换。
- WSL 用户态安装入口、桌面 keyring 存储和日志脱敏通过审查。
