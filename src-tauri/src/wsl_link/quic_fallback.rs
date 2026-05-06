use prost::Message;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::{
    agent::WslLinkAgentService,
    noise::{WslLinkNoiseError, WslLinkNoiseTransport},
    protocol::v1::{ClientFrame, ServerFrame},
};

pub const DEFAULT_MAX_QUIC_FRAME_BYTES: usize = 4 * 1024 * 1024;
const FRAME_LENGTH_PREFIX_BYTES: usize = 4;

#[derive(Debug, Error)]
pub enum WslLinkQuicError {
    #[error("WSL Link QUIC frame 超过上限：{len} > {max}")]
    FrameTooLarge { len: usize, max: usize },
    #[error("WSL Link QUIC frame 编码失败：{0}")]
    Encode(#[from] prost::EncodeError),
    #[error("WSL Link QUIC frame 解码失败：{0}")]
    Decode(#[from] prost::DecodeError),
    #[error("WSL Link QUIC IO 失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("WSL Link QUIC 连接失败：{0}")]
    Connection(#[from] quinn::ConnectionError),
    #[error("WSL Link QUIC stream finish 失败。")]
    Finish,
    #[error("WSL Link QUIC 服务处理失败：{0}")]
    Service(#[from] tonic::Status),
    #[error("WSL Link QUIC Noise 保护失败：{0}")]
    Noise(#[from] WslLinkNoiseError),
}

pub async fn write_client_frame<W>(
    writer: &mut W,
    frame: &ClientFrame,
) -> Result<(), WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
{
    write_prost_frame(writer, frame, DEFAULT_MAX_QUIC_FRAME_BYTES).await
}

pub async fn read_client_frame<R>(reader: &mut R) -> Result<ClientFrame, WslLinkQuicError>
where
    R: AsyncRead + Unpin,
{
    read_prost_frame(reader, DEFAULT_MAX_QUIC_FRAME_BYTES).await
}

pub async fn write_server_frame<W>(
    writer: &mut W,
    frame: &ServerFrame,
) -> Result<(), WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
{
    write_prost_frame(writer, frame, DEFAULT_MAX_QUIC_FRAME_BYTES).await
}

pub async fn read_server_frame<R>(reader: &mut R) -> Result<ServerFrame, WslLinkQuicError>
where
    R: AsyncRead + Unpin,
{
    read_prost_frame(reader, DEFAULT_MAX_QUIC_FRAME_BYTES).await
}

pub async fn request_response_over_stream<W, R>(
    writer: &mut W,
    reader: &mut R,
    frame: &ClientFrame,
) -> Result<ServerFrame, WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
    R: AsyncRead + Unpin,
{
    write_client_frame(writer, frame).await?;
    writer.flush().await?;
    read_server_frame(reader).await
}

pub async fn write_noise_client_frame<W>(
    writer: &mut W,
    noise: &mut WslLinkNoiseTransport,
    frame: &ClientFrame,
) -> Result<(), WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
{
    write_noise_prost_frame(writer, noise, frame).await
}

pub async fn read_noise_client_frame<R>(
    reader: &mut R,
    noise: &mut WslLinkNoiseTransport,
) -> Result<ClientFrame, WslLinkQuicError>
where
    R: AsyncRead + Unpin,
{
    read_noise_prost_frame(reader, noise).await
}

pub async fn write_noise_server_frame<W>(
    writer: &mut W,
    noise: &mut WslLinkNoiseTransport,
    frame: &ServerFrame,
) -> Result<(), WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
{
    write_noise_prost_frame(writer, noise, frame).await
}

pub async fn read_noise_server_frame<R>(
    reader: &mut R,
    noise: &mut WslLinkNoiseTransport,
) -> Result<ServerFrame, WslLinkQuicError>
where
    R: AsyncRead + Unpin,
{
    read_noise_prost_frame(reader, noise).await
}

pub async fn request_response_over_noise_stream<W, R>(
    writer: &mut W,
    reader: &mut R,
    noise: &mut WslLinkNoiseTransport,
    frame: &ClientFrame,
) -> Result<ServerFrame, WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
    R: AsyncRead + Unpin,
{
    write_noise_client_frame(writer, noise, frame).await?;
    writer.flush().await?;
    read_noise_server_frame(reader, noise).await
}

pub async fn serve_noise_single_frame<W, R, F>(
    writer: &mut W,
    reader: &mut R,
    noise: &mut WslLinkNoiseTransport,
    handle_frame: F,
) -> Result<ServerFrame, WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
    R: AsyncRead + Unpin,
    F: FnOnce(ClientFrame) -> Result<ServerFrame, tonic::Status>,
{
    let frame = read_noise_client_frame(reader, noise).await?;
    let response = handle_frame(frame)?;
    write_noise_server_frame(writer, noise, &response).await?;
    writer.flush().await?;
    Ok(response)
}

pub async fn serve_single_frame<W, R, F>(
    writer: &mut W,
    reader: &mut R,
    handle_frame: F,
) -> Result<ServerFrame, WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
    R: AsyncRead + Unpin,
    F: FnOnce(ClientFrame) -> Result<ServerFrame, tonic::Status>,
{
    let frame = read_client_frame(reader).await?;
    let response = handle_frame(frame)?;
    write_server_frame(writer, &response).await?;
    writer.flush().await?;
    Ok(response)
}

pub async fn request_response_over_quic(
    send: &mut quinn::SendStream,
    recv: &mut quinn::RecvStream,
    frame: &ClientFrame,
) -> Result<ServerFrame, WslLinkQuicError> {
    write_client_frame(send, frame).await?;
    send.finish().map_err(|_| WslLinkQuicError::Finish)?;
    read_server_frame(recv).await
}

pub async fn request_response_over_connection(
    connection: &quinn::Connection,
    frame: &ClientFrame,
) -> Result<ServerFrame, WslLinkQuicError> {
    let (mut send, mut recv) = connection.open_bi().await?;
    request_response_over_quic(&mut send, &mut recv, frame).await
}

pub async fn serve_quic_bi_stream(
    send: &mut quinn::SendStream,
    recv: &mut quinn::RecvStream,
    service: &WslLinkAgentService,
) -> Result<ServerFrame, WslLinkQuicError> {
    let response =
        serve_single_frame(send, recv, |frame| service.handle_client_frame(frame)).await?;
    send.finish().map_err(|_| WslLinkQuicError::Finish)?;
    Ok(response)
}

pub async fn serve_quic_connection(
    connection: quinn::Connection,
    service: WslLinkAgentService,
) -> Result<(), WslLinkQuicError> {
    loop {
        let (mut send, mut recv) = match connection.accept_bi().await {
            Ok(stream) => stream,
            Err(quinn::ConnectionError::LocallyClosed) => return Ok(()),
            Err(error) => return Err(WslLinkQuicError::Connection(error)),
        };
        let stream_service = service.clone();

        tokio::spawn(async move {
            if let Err(error) = serve_quic_bi_stream(&mut send, &mut recv, &stream_service).await {
                tracing::warn!(error = %error, "WSL Link QUIC bi-stream 处理失败");
            }
        });
    }
}

pub async fn serve_quic_endpoint(
    endpoint: quinn::Endpoint,
    service: WslLinkAgentService,
) -> Result<(), WslLinkQuicError> {
    while let Some(incoming) = endpoint.accept().await {
        let connection = incoming.await?;
        let connection_service = service.clone();

        tokio::spawn(async move {
            if let Err(error) = serve_quic_connection(connection, connection_service).await {
                tracing::warn!(error = %error, "WSL Link QUIC connection 处理失败");
            }
        });
    }

    Ok(())
}

async fn write_prost_frame<W, M>(
    writer: &mut W,
    message: &M,
    max_frame_bytes: usize,
) -> Result<(), WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
    M: Message,
{
    let payload_len = message.encoded_len();
    ensure_frame_len(payload_len, max_frame_bytes)?;

    let mut buffer = Vec::with_capacity(payload_len);
    message.encode(&mut buffer)?;
    write_raw_frame(writer, &buffer, max_frame_bytes).await
}

async fn read_prost_frame<R, M>(
    reader: &mut R,
    max_frame_bytes: usize,
) -> Result<M, WslLinkQuicError>
where
    R: AsyncRead + Unpin,
    M: Message + Default,
{
    let payload = read_raw_frame(reader, max_frame_bytes).await?;
    Ok(M::decode(payload.as_slice())?)
}

async fn write_noise_prost_frame<W, M>(
    writer: &mut W,
    noise: &mut WslLinkNoiseTransport,
    message: &M,
) -> Result<(), WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
    M: Message,
{
    let payload_len = message.encoded_len();
    ensure_frame_len(payload_len, DEFAULT_MAX_QUIC_FRAME_BYTES)?;

    let mut payload = Vec::with_capacity(payload_len);
    message.encode(&mut payload)?;
    let ciphertext = noise.encrypt_frame(&payload)?;
    write_raw_frame(writer, &ciphertext, DEFAULT_MAX_QUIC_FRAME_BYTES).await
}

async fn read_noise_prost_frame<R, M>(
    reader: &mut R,
    noise: &mut WslLinkNoiseTransport,
) -> Result<M, WslLinkQuicError>
where
    R: AsyncRead + Unpin,
    M: Message + Default,
{
    let ciphertext = read_raw_frame(reader, DEFAULT_MAX_QUIC_FRAME_BYTES).await?;
    let payload = noise.decrypt_frame(&ciphertext)?;
    Ok(M::decode(payload.as_slice())?)
}

async fn write_raw_frame<W>(
    writer: &mut W,
    payload: &[u8],
    max_frame_bytes: usize,
) -> Result<(), WslLinkQuicError>
where
    W: AsyncWrite + Unpin,
{
    ensure_frame_len(payload.len(), max_frame_bytes)?;

    let mut buffer = Vec::with_capacity(FRAME_LENGTH_PREFIX_BYTES + payload.len());
    buffer.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    buffer.extend_from_slice(payload);
    writer.write_all(&buffer).await?;
    Ok(())
}

async fn read_raw_frame<R>(
    reader: &mut R,
    max_frame_bytes: usize,
) -> Result<Vec<u8>, WslLinkQuicError>
where
    R: AsyncRead + Unpin,
{
    let mut len_buf = [0_u8; FRAME_LENGTH_PREFIX_BYTES];
    reader.read_exact(&mut len_buf).await?;
    let payload_len = u32::from_be_bytes(len_buf) as usize;
    ensure_frame_len(payload_len, max_frame_bytes)?;

    let mut payload = vec![0_u8; payload_len];
    reader.read_exact(&mut payload).await?;
    Ok(payload)
}

fn ensure_frame_len(len: usize, max: usize) -> Result<(), WslLinkQuicError> {
    if len > max || len > u32::MAX as usize {
        return Err(WslLinkQuicError::FrameTooLarge { len, max });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tokio::io::{duplex, split};
    use tonic::Request;

    use super::{
        super::{
            noise::{
                complete_handshake, generate_static_keypair, WslLinkNoiseHandshakeConfig,
                WslLinkNoisePsk, WSL_LINK_NOISE_KEY_BYTES,
            },
            protocol::v1::{wsl_link_server::WslLink, OpenSessionRequest, TransportKind},
            types::DEFAULT_PROTOCOL_VERSION,
        },
        *,
    };

    fn client_frame(session_id: String, client_seq: u64) -> ClientFrame {
        ClientFrame {
            session_id,
            request_id: format!("request-{client_seq}"),
            idempotency_key: "idem-1".to_string(),
            client_seq,
            ack_server_seq: 0,
            payload: b"payload".to_vec(),
            trace_id: format!("trace-{client_seq}"),
        }
    }

    async fn open_session(service: &WslLinkAgentService) -> String {
        service
            .open_session(Request::new(OpenSessionRequest {
                client_id: "desktop".to_string(),
                protocol_version: DEFAULT_PROTOCOL_VERSION.to_string(),
                last_client_seq: 0,
                trace_id: "trace-open".to_string(),
            }))
            .await
            .expect("open session should work")
            .into_inner()
            .session_id
    }

    fn noise_transports() -> (WslLinkNoiseTransport, WslLinkNoiseTransport) {
        let desktop = generate_static_keypair().expect("desktop keypair should generate");
        let agent = generate_static_keypair().expect("agent keypair should generate");
        let psk = WslLinkNoisePsk::from_bytes([9; WSL_LINK_NOISE_KEY_BYTES]);
        let desktop_config =
            WslLinkNoiseHandshakeConfig::new(*desktop.private(), *agent.public(), psk.clone());
        let agent_config =
            WslLinkNoiseHandshakeConfig::new(*agent.private(), *desktop.public(), psk);

        complete_handshake(&desktop_config, &agent_config).expect("Noise handshake should complete")
    }

    #[tokio::test]
    async fn client_frame_roundtrips_with_length_prefix() {
        let frame = client_frame("s1".to_string(), 1);
        let (mut writer, mut reader) = duplex(1024);

        write_client_frame(&mut writer, &frame)
            .await
            .expect("write should work");
        let decoded = read_client_frame(&mut reader)
            .await
            .expect("read should work");

        assert_eq!(decoded, frame);
    }

    #[tokio::test]
    async fn oversized_frame_is_rejected_before_write() {
        let frame = client_frame("s1".to_string(), 1);
        let (mut writer, _reader) = duplex(1024);

        let result = write_prost_frame(&mut writer, &frame, 8).await;

        assert!(matches!(
            result,
            Err(WslLinkQuicError::FrameTooLarge { .. })
        ));
    }

    #[tokio::test]
    async fn server_stream_handler_uses_agent_session_and_idempotency_cache() {
        let service = WslLinkAgentService::new();
        let session_id = open_session(&service).await;
        let frame = client_frame(session_id, 1);
        let (client_stream, server_stream) = duplex(4096);
        let (mut client_reader, mut client_writer) = split(client_stream);
        let (mut server_reader, mut server_writer) = split(server_stream);
        let server_service = service.clone();

        let server_task = tokio::spawn(async move {
            serve_single_frame(&mut server_writer, &mut server_reader, |frame| {
                server_service.handle_client_frame(frame)
            })
            .await
        });

        write_client_frame(&mut client_writer, &frame)
            .await
            .expect("client write should work");
        let response = read_server_frame(&mut client_reader)
            .await
            .expect("client read should work");
        let handled = server_task
            .await
            .expect("server task should join")
            .expect("server handler should work");

        assert_eq!(response, handled);
        assert_eq!(response.ack_client_seq, 1);
        assert_eq!(response.payload, b"payload");
    }

    #[tokio::test]
    async fn noise_stream_handler_encrypts_agent_frame() {
        let service = WslLinkAgentService::new();
        let session_id = open_session(&service).await;
        let frame = client_frame(session_id, 1);
        let (mut client_noise, mut server_noise) = noise_transports();
        let (client_stream, server_stream) = duplex(4096);
        let (mut client_reader, mut client_writer) = split(client_stream);
        let (mut server_reader, mut server_writer) = split(server_stream);
        let server_service = service.clone();

        let server_task = tokio::spawn(async move {
            serve_noise_single_frame(
                &mut server_writer,
                &mut server_reader,
                &mut server_noise,
                |frame| server_service.handle_client_frame(frame),
            )
            .await
        });

        let response = request_response_over_noise_stream(
            &mut client_writer,
            &mut client_reader,
            &mut client_noise,
            &frame,
        )
        .await
        .expect("Noise protected request should work");
        let handled = server_task
            .await
            .expect("server task should join")
            .expect("server handler should work");

        assert_eq!(response, handled);
        assert_eq!(response.ack_client_seq, 1);
        assert_eq!(response.payload, b"payload");
    }

    #[tokio::test]
    async fn quic_fallback_transport_kind_matches_proto_enum() {
        assert_eq!(TransportKind::MirroredQuic as i32, 2);
    }
}
