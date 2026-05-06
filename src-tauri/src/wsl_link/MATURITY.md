---
status: yellow
owner: xiaojianc
updated: 2026-05-06
---

# WSL Link 成熟度

## 当前状态

`yellow`：架构与可靠性核心已落地，并完成 gRPC / QUIC 协议生成、连接管理骨架和 WSL agent gRPC 服务实现。当前阶段只允许提供状态机、退避、熔断、WAL outbox、hedged 策略、协议契约、keepalive 配置、传输 adapter 边界和 agent 协议服务，不得替换现有终端生产链路。

## 关键缺口

- Windows `AF_HYPERV` socket adapter 已登记平台常量，尚未完成 WSL VM GUID 解析和 WinSock stream 封装。
- Linux WSL agent 已新增 `src/bin/wsl_link_agent.rs` 入口和 `OpenSession / ResumeSession / Heartbeat / Duplex` 服务实现，尚未在 WSL2 真机内完成 `AF_VSOCK` listener 运行验证和分发脚本。
- mirrored networking QUIC fallback 已接入 `quinn` 配置层，尚未完成证书/握手认证和真实 socket 切流。
- 握手认证、指标面板和 E2E 断线恢复测试尚未完成。

## 升级条件

- P2 主备传输均通过真机矩阵。
- P3 终端 / 脚本执行可通过 feature flag 切换。
- 安全握手和日志脱敏通过审查。
