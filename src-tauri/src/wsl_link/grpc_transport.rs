use thiserror::Error;
use tonic::transport::Channel;

use super::{
    config::WslLinkTransportConfig,
    protocol::v1::{
        wsl_link_client::WslLinkClient, OpenSessionRequest, OpenSessionResponse, TransportKind,
    },
    types::{WslLinkTransportKind, DEFAULT_PROTOCOL_VERSION},
};

pub type WslLinkGrpcClient = WslLinkClient<Channel>;

#[derive(Debug, Error)]
pub enum WslLinkGrpcTransportError {
    #[error("WSL Link OpenSession 请求无效：{0}")]
    InvalidOpenSessionRequest(&'static str),
    #[error("WSL Link OpenSession 响应无效：{0}")]
    InvalidOpenSessionResponse(&'static str),
    #[error("WSL Link gRPC 主通道暂不支持当前平台：{0:?}")]
    UnsupportedPlatform(WslLinkTransportKind),
    #[error("WSL Link gRPC 主通道建立失败：{0}")]
    Transport(#[from] tonic::transport::Error),
    #[error("WSL Link OpenSession RPC 失败：{0}")]
    Status(#[from] tonic::Status),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslLinkOpenSessionHandshake {
    client_id: String,
    trace_id: String,
    last_client_seq: u64,
}

impl WslLinkOpenSessionHandshake {
    pub fn new(
        client_id: impl Into<String>,
        trace_id: impl Into<String>,
        last_client_seq: u64,
    ) -> Result<Self, WslLinkGrpcTransportError> {
        let client_id = client_id.into();
        if client_id.trim().is_empty() {
            return Err(WslLinkGrpcTransportError::InvalidOpenSessionRequest(
                "client_id 不能为空。",
            ));
        }

        let trace_id = trace_id.into();
        if trace_id.trim().is_empty() {
            return Err(WslLinkGrpcTransportError::InvalidOpenSessionRequest(
                "trace_id 不能为空。",
            ));
        }

        Ok(Self {
            client_id,
            trace_id,
            last_client_seq,
        })
    }

    pub fn into_proto(self) -> OpenSessionRequest {
        OpenSessionRequest {
            client_id: self.client_id,
            protocol_version: DEFAULT_PROTOCOL_VERSION.to_string(),
            last_client_seq: self.last_client_seq,
            trace_id: self.trace_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslLinkGrpcSession {
    pub session_id: String,
    pub server_seq: u64,
    pub ack_client_seq: u64,
    pub transport: WslLinkTransportKind,
}

impl WslLinkGrpcSession {
    pub fn try_from_open_session_response(
        response: OpenSessionResponse,
    ) -> Result<Self, WslLinkGrpcTransportError> {
        if response.session_id.trim().is_empty() {
            return Err(WslLinkGrpcTransportError::InvalidOpenSessionResponse(
                "session_id 不能为空。",
            ));
        }
        if response.server_seq == 0 {
            return Err(WslLinkGrpcTransportError::InvalidOpenSessionResponse(
                "server_seq 必须大于 0。",
            ));
        }

        let transport = match TransportKind::try_from(response.transport)
            .unwrap_or(TransportKind::Unspecified)
        {
            TransportKind::VsockGrpc => WslLinkTransportKind::VsockGrpc,
            TransportKind::MirroredQuic => WslLinkTransportKind::MirroredQuic,
            TransportKind::Unspecified => {
                return Err(WslLinkGrpcTransportError::InvalidOpenSessionResponse(
                    "transport 不能为空。",
                ));
            }
        };

        Ok(Self {
            session_id: response.session_id,
            server_seq: response.server_seq,
            ack_client_seq: response.ack_client_seq,
            transport,
        })
    }
}

pub async fn connect_primary_grpc_channel(
    config: WslLinkTransportConfig,
) -> Result<Channel, WslLinkGrpcTransportError> {
    platform_connect_primary_grpc_channel(config).await
}

pub async fn connect_primary_grpc_client(
    config: WslLinkTransportConfig,
) -> Result<WslLinkGrpcClient, WslLinkGrpcTransportError> {
    let channel = connect_primary_grpc_channel(config).await?;
    Ok(WslLinkGrpcClient::new(channel))
}

pub async fn open_primary_grpc_session(
    config: WslLinkTransportConfig,
    handshake: WslLinkOpenSessionHandshake,
) -> Result<WslLinkGrpcSession, WslLinkGrpcTransportError> {
    let mut client = connect_primary_grpc_client(config).await?;
    open_session_with_grpc_client(&mut client, handshake).await
}

pub async fn open_session_with_grpc_client(
    client: &mut WslLinkGrpcClient,
    handshake: WslLinkOpenSessionHandshake,
) -> Result<WslLinkGrpcSession, WslLinkGrpcTransportError> {
    let response = client
        .open_session(handshake.into_proto())
        .await?
        .into_inner();
    WslLinkGrpcSession::try_from_open_session_response(response)
}

#[cfg(windows)]
async fn platform_connect_primary_grpc_channel(
    config: WslLinkTransportConfig,
) -> Result<Channel, WslLinkGrpcTransportError> {
    let endpoint = config.grpc_client_endpoint()?;
    let connector = windows::WslLinkHypervGrpcConnector::new(config.connect_timeout);
    Ok(endpoint.connect_with_connector(connector).await?)
}

#[cfg(not(windows))]
async fn platform_connect_primary_grpc_channel(
    config: WslLinkTransportConfig,
) -> Result<Channel, WslLinkGrpcTransportError> {
    Err(WslLinkGrpcTransportError::UnsupportedPlatform(
        config.primary_transport(),
    ))
}

#[cfg(windows)]
mod windows {
    use std::{
        future::Future,
        pin::Pin,
        task::{Context, Poll},
        time::Duration,
    };

    use hyper_util::rt::TokioIo;
    use tonic::{codegen::Service, transport::Uri};

    use crate::wsl_link::adapters::windows_hyperv::{
        connect_wsl_vsock_grpc_stream, WslLinkHypervConnectError,
    };

    #[derive(Debug, Clone, Copy)]
    pub struct WslLinkHypervGrpcConnector {
        connect_timeout: Duration,
    }

    impl WslLinkHypervGrpcConnector {
        pub fn new(connect_timeout: Duration) -> Self {
            Self { connect_timeout }
        }

        pub fn connect_timeout(&self) -> Duration {
            self.connect_timeout
        }
    }

    impl Service<Uri> for WslLinkHypervGrpcConnector {
        type Response = TokioIo<tokio::net::TcpStream>;
        type Error = WslLinkHypervConnectError;
        type Future =
            Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send + 'static>>;

        fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }

        fn call(&mut self, _request: Uri) -> Self::Future {
            let timeout = self.connect_timeout;
            Box::pin(async move {
                let stream = connect_wsl_vsock_grpc_stream(timeout).await?;
                Ok(TokioIo::new(stream))
            })
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    use super::*;

    use crate::wsl_link::protocol::v1::TransportKind;

    #[test]
    fn open_session_handshake_rejects_empty_client_id() {
        let result = super::WslLinkOpenSessionHandshake::new("  ", "trace-1", 0);

        assert!(matches!(
            result,
            Err(super::WslLinkGrpcTransportError::InvalidOpenSessionRequest(
                _
            ))
        ));
    }

    #[test]
    fn open_session_handshake_builds_versioned_proto_request() {
        let request = super::WslLinkOpenSessionHandshake::new("desktop-1", "trace-1", 7)
            .expect("handshake should be valid")
            .into_proto();

        assert_eq!(request.client_id, "desktop-1");
        assert_eq!(
            request.protocol_version,
            crate::wsl_link::types::DEFAULT_PROTOCOL_VERSION
        );
        assert_eq!(request.last_client_seq, 7);
        assert_eq!(request.trace_id, "trace-1");
    }

    #[test]
    fn open_session_response_maps_transport_kind() {
        let session = super::WslLinkGrpcSession::try_from_open_session_response(
            crate::wsl_link::protocol::v1::OpenSessionResponse {
                session_id: "s1".to_string(),
                server_seq: 1,
                ack_client_seq: 7,
                transport: TransportKind::VsockGrpc as i32,
            },
        )
        .expect("response should map");

        assert_eq!(session.session_id, "s1");
        assert_eq!(session.server_seq, 1);
        assert_eq!(session.ack_client_seq, 7);
        assert_eq!(
            session.transport,
            crate::wsl_link::types::WslLinkTransportKind::VsockGrpc
        );
    }

    #[test]
    fn open_session_response_rejects_unspecified_transport() {
        let result = super::WslLinkGrpcSession::try_from_open_session_response(
            crate::wsl_link::protocol::v1::OpenSessionResponse {
                session_id: "s1".to_string(),
                server_seq: 1,
                ack_client_seq: 0,
                transport: TransportKind::Unspecified as i32,
            },
        );

        assert!(matches!(
            result,
            Err(super::WslLinkGrpcTransportError::InvalidOpenSessionResponse(_))
        ));
    }

    #[cfg(windows)]
    #[test]
    fn windows_connector_keeps_configured_timeout() {
        let connector =
            super::windows::WslLinkHypervGrpcConnector::new(std::time::Duration::from_millis(123));

        assert_eq!(
            connector.connect_timeout(),
            std::time::Duration::from_millis(123)
        );
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn primary_grpc_channel_reports_unsupported_platform() {
        let result = connect_primary_grpc_channel(WslLinkTransportConfig::default()).await;

        assert!(matches!(
            result,
            Err(WslLinkGrpcTransportError::UnsupportedPlatform(
                WslLinkTransportKind::VsockGrpc
            ))
        ));
    }
}
