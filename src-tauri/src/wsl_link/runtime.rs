use std::sync::Mutex;

use serde::Serialize;

use super::{
    circuit_breaker::CircuitBreakerState,
    manager::WslLinkManager,
    state_machine::WslLinkConnectionState,
    types::{WslLinkMetrics, WslLinkTransportKind, DEFAULT_PROTOCOL_VERSION},
};

#[derive(Debug)]
struct WslLinkRuntimeInner {
    manager: WslLinkManager,
}

impl Default for WslLinkRuntimeInner {
    fn default() -> Self {
        Self {
            manager: WslLinkManager::default(),
        }
    }
}

#[derive(Debug, Default)]
pub struct WslLinkRuntimeState {
    inner: Mutex<WslLinkRuntimeInner>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkStatusPayload {
    pub state: WslLinkConnectionState,
    pub maturity: &'static str,
    pub protocol_version: &'static str,
    pub primary_transport: WslLinkTransportKind,
    pub fallback_transport: WslLinkTransportKind,
    pub vsock_grpc_port: u32,
    pub mirrored_quic_port: u16,
    pub circuit_breaker: CircuitBreakerState,
    pub metrics: WslLinkMetrics,
    pub note: &'static str,
}

impl WslLinkRuntimeState {
    pub fn snapshot(&self) -> WslLinkStatusPayload {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let config = inner.manager.config();
        let metrics = inner.manager.metrics();

        WslLinkStatusPayload {
            state: inner.manager.state(),
            maturity: "yellow",
            protocol_version: DEFAULT_PROTOCOL_VERSION,
            primary_transport: config.primary_transport(),
            fallback_transport: config.fallback_transport(),
            vsock_grpc_port: config.vsock_grpc_port,
            mirrored_quic_port: config.mirrored_quic_port,
            circuit_breaker: inner.manager.circuit_breaker_state(),
            metrics,
            note: "WSL Link 已接入 gRPC/QUIC 协议生成、keepalive 配置、hedged 连接管理与 adapter 边界；WSL agent 和真实 AF_HYPERV/AF_VSOCK socket 尚未切流。",
        }
    }
}
