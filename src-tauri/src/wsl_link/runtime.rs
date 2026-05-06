use std::sync::Mutex;

use serde::Serialize;

use super::{
    circuit_breaker::CircuitBreakerState,
    config::WslLinkTransportConfig,
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
    pub fn begin_connect_attempt(&self) -> Result<WslLinkTransportConfig, String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .begin_manual_connect_attempt()
            .map_err(|error| error.to_string())?;
        Ok(inner.manager.config())
    }

    pub fn record_connect_success(&self, transport: WslLinkTransportKind) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .record_handshake_ok(transport)
            .map_err(|error| error.to_string())
    }

    pub fn record_connect_failure(&self, error_message: String) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .record_connect_error(error_message)
            .map_err(|error| error.to_string())
    }

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
            note: "WSL Link 已接入 gRPC/QUIC 协议生成、keepalive 配置、hedged 连接管理、WSL agent 服务、agent Noise 配置启动校验、agent 用户态分发命令计划、payload 执行器、显式确认安装/后台启动命令、Windows AF_HYPERV 地址/GUID 解析、非阻塞 connect、tonic Channel connector 与 OpenSession 握手执行器、QUIC bi-stream 骨架、Noise_KKpsk2 安全帧、桌面 keyring 密钥材料接口和只读环境自检；真机握手矩阵、UI 安装入口和终端切流尚未启用。",
        }
    }
}
