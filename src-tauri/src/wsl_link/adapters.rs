use std::{net::SocketAddr, time::Duration};

use super::{
    config::WslLinkTransportConfig,
    manager::WslLinkTransportAdapter,
    types::{WslLinkTransportKind, DEFAULT_MIRRORED_QUIC_PORT, DEFAULT_VSOCK_GRPC_PORT},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VsockGrpcEndpoint {
    pub port: u32,
}

impl Default for VsockGrpcEndpoint {
    fn default() -> Self {
        Self {
            port: DEFAULT_VSOCK_GRPC_PORT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MirroredQuicEndpoint {
    pub addr: SocketAddr,
}

impl Default for MirroredQuicEndpoint {
    fn default() -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], DEFAULT_MIRRORED_QUIC_PORT)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VsockGrpcAdapter {
    endpoint: VsockGrpcEndpoint,
    is_platform_available: bool,
}

impl VsockGrpcAdapter {
    pub fn new(endpoint: VsockGrpcEndpoint) -> Self {
        Self {
            endpoint,
            is_platform_available: cfg!(windows) || cfg!(target_os = "linux"),
        }
    }

    pub fn endpoint(&self) -> &VsockGrpcEndpoint {
        &self.endpoint
    }
}

impl WslLinkTransportAdapter for VsockGrpcAdapter {
    fn kind(&self) -> WslLinkTransportKind {
        WslLinkTransportKind::VsockGrpc
    }

    fn is_available(&self) -> bool {
        self.is_platform_available
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MirroredQuicAdapter {
    endpoint: MirroredQuicEndpoint,
    connect_timeout: Duration,
}

impl MirroredQuicAdapter {
    pub fn new(endpoint: MirroredQuicEndpoint, config: WslLinkTransportConfig) -> Self {
        Self {
            endpoint,
            connect_timeout: config.connect_timeout,
        }
    }

    pub fn endpoint(&self) -> &MirroredQuicEndpoint {
        &self.endpoint
    }

    pub fn connect_timeout(&self) -> Duration {
        self.connect_timeout
    }
}

impl WslLinkTransportAdapter for MirroredQuicAdapter {
    fn kind(&self) -> WslLinkTransportKind {
        WslLinkTransportKind::MirroredQuic
    }

    fn is_available(&self) -> bool {
        self.endpoint.addr.ip().is_loopback()
    }
}

#[cfg(windows)]
pub mod windows_hyperv {
    use windows_sys::Win32::{Networking::WinSock::AF_HYPERV, System::Hypervisor::HV_PROTOCOL_RAW};

    pub const WSL_LINK_AF_HYPERV: u16 = AF_HYPERV;
    pub const WSL_LINK_HV_PROTOCOL_RAW: u32 = HV_PROTOCOL_RAW;
}

#[cfg(target_os = "linux")]
pub mod linux_vsock {
    pub use tokio_vsock::{VsockListener, VsockStream, VMADDR_CID_ANY, VMADDR_CID_HOST};
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wsl_link::manager::WslLinkTransportAdapter;

    #[test]
    fn mirrored_quic_adapter_requires_loopback_endpoint() {
        let adapter = MirroredQuicAdapter::new(
            MirroredQuicEndpoint::default(),
            WslLinkTransportConfig::default(),
        );

        assert_eq!(adapter.kind(), WslLinkTransportKind::MirroredQuic);
        assert!(adapter.is_available());
    }

    #[test]
    fn vsock_grpc_adapter_uses_reserved_port() {
        let adapter = VsockGrpcAdapter::new(VsockGrpcEndpoint::default());

        assert_eq!(adapter.kind(), WslLinkTransportKind::VsockGrpc);
        assert_eq!(adapter.endpoint().port, DEFAULT_VSOCK_GRPC_PORT);
    }
}
