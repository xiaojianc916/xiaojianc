use std::time::Duration;

use quinn::{IdleTimeout, TransportConfig};
use thiserror::Error;
use tonic::transport::{Endpoint, Server};

use super::types::{WslLinkTransportKind, DEFAULT_MIRRORED_QUIC_PORT, DEFAULT_VSOCK_GRPC_PORT};

pub const DEFAULT_GRPC_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
pub const DEFAULT_GRPC_KEEPALIVE_TIMEOUT: Duration = Duration::from_secs(20);
pub const DEFAULT_QUIC_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
pub const DEFAULT_QUIC_MAX_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
pub const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub const DEFAULT_HEDGED_AFTER: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WslLinkTransportConfig {
    pub vsock_grpc_port: u32,
    pub mirrored_quic_port: u16,
    pub grpc_keepalive_interval: Duration,
    pub grpc_keepalive_timeout: Duration,
    pub quic_keepalive_interval: Duration,
    pub quic_max_idle_timeout: Duration,
    pub connect_timeout: Duration,
    pub request_timeout: Duration,
    pub hedged_after: Duration,
}

impl Default for WslLinkTransportConfig {
    fn default() -> Self {
        Self {
            vsock_grpc_port: DEFAULT_VSOCK_GRPC_PORT,
            mirrored_quic_port: DEFAULT_MIRRORED_QUIC_PORT,
            grpc_keepalive_interval: DEFAULT_GRPC_KEEPALIVE_INTERVAL,
            grpc_keepalive_timeout: DEFAULT_GRPC_KEEPALIVE_TIMEOUT,
            quic_keepalive_interval: DEFAULT_QUIC_KEEPALIVE_INTERVAL,
            quic_max_idle_timeout: DEFAULT_QUIC_MAX_IDLE_TIMEOUT,
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
            hedged_after: DEFAULT_HEDGED_AFTER,
        }
    }
}

#[derive(Debug, Error)]
pub enum WslLinkConfigError {
    #[error("WSL Link QUIC idle timeout 配置无效：{0}")]
    InvalidQuicIdleTimeout(String),
}

impl WslLinkTransportConfig {
    pub fn primary_transport(&self) -> WslLinkTransportKind {
        WslLinkTransportKind::VsockGrpc
    }

    pub fn fallback_transport(&self) -> WslLinkTransportKind {
        WslLinkTransportKind::MirroredQuic
    }

    pub fn grpc_client_endpoint(&self) -> Result<Endpoint, tonic::transport::Error> {
        Ok(Endpoint::try_from("http://[::]:0")?
            .connect_timeout(self.connect_timeout)
            .timeout(self.request_timeout)
            .http2_keep_alive_interval(self.grpc_keepalive_interval)
            .keep_alive_timeout(self.grpc_keepalive_timeout)
            .keep_alive_while_idle(true)
            .tcp_nodelay(true))
    }

    pub fn grpc_server_builder(&self) -> Server {
        Server::builder()
            .http2_keepalive_interval(Some(self.grpc_keepalive_interval))
            .http2_keepalive_timeout(Some(self.grpc_keepalive_timeout))
    }

    pub fn quic_transport_config(&self) -> Result<TransportConfig, WslLinkConfigError> {
        let idle_timeout = IdleTimeout::try_from(self.quic_max_idle_timeout)
            .map_err(|error| WslLinkConfigError::InvalidQuicIdleTimeout(error.to_string()))?;
        let mut config = TransportConfig::default();
        config.keep_alive_interval(Some(self.quic_keepalive_interval));
        config.max_idle_timeout(Some(idle_timeout));
        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_matches_requested_topology() {
        let config = WslLinkTransportConfig::default();

        assert_eq!(config.primary_transport(), WslLinkTransportKind::VsockGrpc);
        assert_eq!(
            config.fallback_transport(),
            WslLinkTransportKind::MirroredQuic
        );
        assert_eq!(config.grpc_keepalive_interval, Duration::from_secs(10));
        assert_eq!(config.grpc_keepalive_timeout, Duration::from_secs(20));
        assert_eq!(config.quic_max_idle_timeout, Duration::from_secs(30));
    }

    #[test]
    fn quic_transport_config_enables_keepalive_and_idle_timeout() {
        let config = WslLinkTransportConfig::default();

        assert!(config.quic_transport_config().is_ok());
    }
}
