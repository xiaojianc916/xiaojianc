# ADR-20260506 WSL Link 双通道可靠连接

- **日期**：2026-05-06
- **状态**：`proposed`
- **决策者**：Calamex maintainers

---

## 背景

当前桌面端通过 `wsl.exe`、PTY 与 Tauri Event 承载 WSL2 终端和脚本执行。该模型可用，但在高频命令、长会话、休眠恢复、WSL 重启和网络模式变化时，会暴露三个问题：

- 冷启动或反复 spawn 的固定开销不可忽略，影响首包延迟与连续操作吞吐。
- 终端字节流、命令请求和状态事件缺少统一的 session / seq / ack 语义，断线后只能重新开始，不能可靠恢复。
- 现有链路没有明确的主备通道、熔断、outbox 和观测指标，排障依赖人工复现。

不做决策的代价是：后续 AI 执行、长任务、终端恢复和跨 WSL2 边界的高性能交互会继续绑定在 `wsl.exe` 生命周期上，无法达到“常驻、低延迟、可恢复”的产品体验。

## 决策

采用 **WSL Link** 作为新的 WSL2 通信层：

1. **主通道**：Windows Tauri Rust 侧通过 Hyper-V Socket / `AF_HYPERV` 连接 WSL2 agent，WSL2 Linux 侧以 `AF_VSOCK` 接入，业务协议使用 `tonic` gRPC over HTTP/2，并开启 HTTP/2 keepalive。
2. **降级通道**：当主通道不可用、熔断或握手超时时，降级到 WSL mirrored networking 下的 `localhost` QUIC，Rust 侧使用 `quinn`。
3. **双通道 hedged**：正常优先主通道；超过 hedged 阈值或主通道进入 `Degraded / Backoff` 时并行发起降级通道，谁先握手成功谁成为 active channel。
4. **断线重连 7 件套**：
   - 应用层心跳；
   - 指数退避 + 抖动；
   - 会话恢复 `Resume(session_id, last_ack_server_seq, last_client_seq)`；
   - 幂等序号 `client_seq` + `idempotency_key`；
   - 本地 WAL outbox；
   - 熔断降级；
   - 双通道 hedged。
5. **协议契约**：新增 `proto/wsl-link/v1/wsl_link.proto`，所有跨 VM 消息必须带 session / seq / ack / trace 字段。
6. **状态权威**：Rust 侧维护 `Idle / Connecting / Ready / Degraded / Reconnecting / Resuming / Backoff / Closed` 状态机，前端只镜像状态和指标。
7. **观测指标**：登记 `wsl_link_rtt_ms`、`wsl_link_reconnects_total`、`wsl_link_inflight_requests`、`wsl_link_outbox_depth`、`wsl_link_active_transport`。
8. **安全边界**：vsock 和 localhost QUIC 都必须完成应用层握手。正式启用前必须接入 mTLS、Noise 或 HMAC token 中的一种；token 不得进入前端 store。

第一阶段先落地可编译、可测试的可靠性核心与协议骨架：状态机、退避抖动、熔断器、WAL outbox、seq/ack/resume 类型和 hedged 策略。随后在桌面端接入 `tonic` / `prost` / `quinn` / `windows-sys` / target-specific `tokio-vsock` 的协议生成、keepalive 配置和 adapter 边界，并新增 WSL agent gRPC 服务实现。具体 socket 切流必须等 WSL VM GUID 解析、握手认证和真机矩阵完成后再启用，避免把未验证的 hvsock / vsock 平台差异扩散到现有终端链路。

## 考虑的备选

| 备选 | 优点 | 缺点 | 否决原因 |
|------|------|------|----------|
| 继续 `wsl.exe` per request | 改动最小 | spawn 成本高；断线不可恢复；IP / 进程生命周期不可控 | 无法满足高性能和可靠恢复目标 |
| SSH over TCP | 调试简单，生态成熟 | 额外加密和 shell 层语义；凭据管理复杂；不适合作为本机主通道 | 作为远程能力可用，不适合作为本机 WSL2 主链路 |
| mirrored localhost + gRPC only | 易落地，兼容好 | 仍走网络栈；mirrored 在部分企业网络 / 防火墙下会失败 | 作为降级通道采纳，不作为主通道 |
| AF_VSOCK + gRPC only | 延迟低，架构清晰 | Windows host 侧需要 `AF_HYPERV` / VM GUID；主通道异常时无备援 | 作为主通道采纳，但必须配降级 |
| AF_VSOCK + gRPC + QUIC fallback + resume | 性能、可靠性、恢复语义完整 | 依赖和实现复杂度最高 | 采纳 |

## 影响

- **正面影响**：
  - WSL agent 常驻，降低首包延迟和连续操作开销。
  - gRPC / QUIC 提供多路复用、流控和 keepalive 基础。
  - session / seq / ack / outbox 让休眠、WSL 重启、前端重载后可恢复未确认消息。
  - hedged 与熔断能把单通道故障转换为可观测的降级状态。
- **负面影响 / 代价**：
  - 新增 Rust 运行时依赖：`tonic`、`tonic-prost`、`prost`、`quinn`、`windows-sys`，以及 Linux target-specific `tokio-vsock`；build 依赖 `tonic-prost-build` 与 `protoc-bin-vendored` 用于可复现 proto 生成。
  - 当前 WAL 使用 JSONL；如后续升级为 `redb` / SQLite，必须单独评估容量、压缩和迁移策略。
  - 已新增 WSL agent binary 入口；仍需要补构建分发、启动自检和 WSL 内真机验证。
  - 安全边界变复杂，必须做握手认证、日志脱敏和 capability 审查。
  - 需要维护 NAT / mirrored / vsock 三类环境的兼容性矩阵。
- **关联规则**：R-0.2、R-1.2、R-7.4、R-7.7、R-7.10、R-9.3、R-14、R-20.4、R-20.9
- **关联任务**：WSL Link P0/P1/P2/P3

## 相关链接

- [AGENTS.md](../../AGENTS.md)
- [Microsoft Learn: Accessing network applications with WSL](https://learn.microsoft.com/en-us/windows/wsl/networking)
- [Microsoft Learn: Advanced settings configuration in WSL](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
- [Microsoft Learn: Hyper-V sockets integration services](https://learn.microsoft.com/en-us/virtualization/hyper-v-on-windows/user-guide/make-integration-service)
- [Linux manual page: vsock(7)](https://man7.org/linux/man-pages/man7/vsock.7.html)

## 迁移计划

1. **P0 可靠性核心**：新增状态机、退避抖动、熔断、WAL outbox、hedged 策略、proto 契约；不替换现有终端链路。已完成。
2. **P1 协议与连接管理骨架**：接入 `tonic` / `prost` generated proto、HTTP/2 keepalive、`quinn` transport config、hedged manager、平台 adapter 边界和状态查询。已完成。
3. **P2 WSL agent**：新增 Rust WSL agent 二进制，支持 gRPC 服务、心跳、resume、ack 和 Duplex 幂等回显。已完成服务实现，待 WSL2 真机验证与分发。
4. **P3 主备传输**：Windows 接入 `AF_HYPERV` adapter；Linux agent 接入 `AF_VSOCK` 真机 listener；降级接入 mirrored localhost QUIC。
5. **P4 终端 / 脚本切流**：把终端和脚本执行入口迁移到 WSL Link，旧 `wsl.exe` 链路保留 feature flag 回滚。
6. **P5 观测与安全**：接入握手认证、指标面板、压力测试和断线恢复 E2E。

---

> 如需推翻本 ADR，MUST 新建新 ADR 并在本文末尾标注 `superseded by ADR-XXXX`，**禁止**就地修改历史决策。
