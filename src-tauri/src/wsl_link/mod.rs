//! WSL Link 可靠连接核心。
//!
//! 当前模块先落地可测试的协议状态核心：状态机、退避抖动、熔断、
//! WAL outbox 与 hedged 策略。真实 `AF_HYPERV` / `AF_VSOCK` / QUIC
//! 传输已按 ADR-20260506 分阶段接入，生产切流必须等待真机矩阵。

// @status: yellow
// 保留原因：ADR-20260506 的 P0 可靠性核心先于生产传输接入落地。
// 复活条件：P1/P2 接入 WSL agent、AF_HYPERV / AF_VSOCK 与 QUIC adapter 后移除此豁免。
// 负责人：xiaojianc
// 截止日期：2026-06-06
#![allow(dead_code)]

pub mod adapters;
pub mod agent;
pub mod agent_distribution;
pub mod agent_install;
pub mod agent_runtime;
pub mod circuit_breaker;
pub mod config;
pub mod grpc_transport;
pub mod manager;
pub mod noise;
pub mod noise_material;
pub mod outbox;
pub mod protocol;
pub mod quic_fallback;
pub mod retry;
pub mod runtime;
pub mod self_check;
pub mod state_machine;
pub mod transport;
pub mod types;
