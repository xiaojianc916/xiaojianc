use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tonic::{Request, Response, Status};

use super::{
    noise::WslLinkNoiseHandshakeConfig,
    noise_material::WslLinkAgentNoiseMaterial,
    protocol::v1::{
        wsl_link_server::WslLink, ClientFrame, HeartbeatRequest, HeartbeatResponse,
        OpenSessionRequest, OpenSessionResponse, ResumeSessionRequest, ResumeSessionResponse,
        ServerFrame, TransportKind,
    },
    types::{now_unix_ms, DEFAULT_PROTOCOL_VERSION},
};

type DuplexStream =
    tonic::codegen::tokio_stream::wrappers::ReceiverStream<Result<ServerFrame, Status>>;

#[derive(Debug, Clone)]
struct AgentSession {
    session_id: String,
    server_seq: u64,
    ack_client_seq: u64,
    idempotency_cache: HashMap<String, ServerFrame>,
}

impl AgentSession {
    fn new(session_id: String, last_client_seq: u64) -> Self {
        Self {
            session_id,
            server_seq: 1,
            ack_client_seq: last_client_seq,
            idempotency_cache: HashMap::new(),
        }
    }

    fn next_server_seq(&mut self) -> u64 {
        let current = self.server_seq;
        self.server_seq = self.server_seq.saturating_add(1);
        current
    }

    fn ack_client_seq(&mut self, client_seq: u64) {
        self.ack_client_seq = self.ack_client_seq.max(client_seq);
    }
}

#[derive(Debug, Default)]
struct AgentState {
    next_session_seq: u64,
    sessions: HashMap<String, AgentSession>,
}

impl AgentState {
    fn create_session(&mut self, last_client_seq: u64) -> (AgentSession, u64) {
        self.next_session_seq = self.next_session_seq.saturating_add(1);
        let session_id = format!("wsl-link-session-{}", self.next_session_seq);
        let mut session = AgentSession::new(session_id.clone(), last_client_seq);
        let initial_server_seq = session.next_server_seq();
        self.sessions.insert(session_id, session.clone());
        (session, initial_server_seq)
    }

    fn get_session_mut(&mut self, session_id: &str) -> Option<&mut AgentSession> {
        self.sessions.get_mut(session_id)
    }
}

#[derive(Debug, Clone, Default)]
pub struct WslLinkAgentService {
    state: Arc<Mutex<AgentState>>,
    noise_material: Option<Arc<WslLinkAgentNoiseMaterial>>,
}

impl WslLinkAgentService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_noise_material(noise_material: WslLinkAgentNoiseMaterial) -> Self {
        Self {
            state: Arc::new(Mutex::new(AgentState::default())),
            noise_material: Some(Arc::new(noise_material)),
        }
    }

    pub fn noise_responder_config(&self) -> Option<WslLinkNoiseHandshakeConfig> {
        self.noise_material
            .as_ref()
            .map(|material| material.responder_config())
    }

    pub fn handle_client_frame(&self, frame: ClientFrame) -> Result<ServerFrame, Status> {
        build_server_frame_with_state(&self.state, frame)
            .unwrap_or_else(|| Err(Status::internal("WSL Link agent 状态锁已损坏。")))
    }
}

#[tonic::async_trait]
impl WslLink for WslLinkAgentService {
    async fn open_session(
        &self,
        request: Request<OpenSessionRequest>,
    ) -> Result<Response<OpenSessionResponse>, Status> {
        let request = request.into_inner();
        if request.client_id.trim().is_empty() {
            return Err(Status::invalid_argument("client_id 不能为空。"));
        }
        if request.protocol_version != DEFAULT_PROTOCOL_VERSION {
            return Err(Status::failed_precondition("WSL Link 协议版本不匹配。"));
        }
        if request.trace_id.trim().is_empty() {
            return Err(Status::invalid_argument("trace_id 不能为空。"));
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
        let (session, server_seq) = state.create_session(request.last_client_seq);

        Ok(Response::new(OpenSessionResponse {
            session_id: session.session_id,
            server_seq,
            ack_client_seq: session.ack_client_seq,
            transport: TransportKind::VsockGrpc as i32,
        }))
    }

    async fn resume_session(
        &self,
        request: Request<ResumeSessionRequest>,
    ) -> Result<Response<ResumeSessionResponse>, Status> {
        let request = request.into_inner();
        if request.session_id.trim().is_empty() {
            return Err(Status::invalid_argument("session_id 不能为空。"));
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
        let Some(session) = state.get_session_mut(&request.session_id) else {
            return Ok(Response::new(ResumeSessionResponse {
                accepted: false,
                server_seq: 0,
                ack_client_seq: 0,
                reason: "session 不存在，需要重新 OpenSession。".to_string(),
            }));
        };

        session.ack_client_seq(request.last_client_seq);
        let server_seq = session
            .server_seq
            .max(request.last_ack_server_seq.saturating_add(1));
        session.server_seq = server_seq.saturating_add(1);

        Ok(Response::new(ResumeSessionResponse {
            accepted: true,
            server_seq,
            ack_client_seq: session.ack_client_seq,
            reason: "已恢复。".to_string(),
        }))
    }

    async fn heartbeat(
        &self,
        request: Request<HeartbeatRequest>,
    ) -> Result<Response<HeartbeatResponse>, Status> {
        let request = request.into_inner();
        let mut state = self
            .state
            .lock()
            .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
        let Some(session) = state.get_session_mut(&request.session_id) else {
            return Err(Status::not_found("session 不存在。"));
        };

        session.ack_client_seq(request.client_seq);
        let server_seq = session.next_server_seq();

        Ok(Response::new(HeartbeatResponse {
            session_id: request.session_id,
            server_seq,
            ack_client_seq: session.ack_client_seq,
            received_at_unix_ms: now_unix_ms().min(i64::MAX as u64) as i64,
        }))
    }

    type DuplexStream = DuplexStream;

    async fn duplex(
        &self,
        request: Request<tonic::Streaming<ClientFrame>>,
    ) -> Result<Response<Self::DuplexStream>, Status> {
        let mut inbound = request.into_inner();
        let state = Arc::clone(&self.state);
        let (tx, rx) = tokio::sync::mpsc::channel(16);

        tokio::spawn(async move {
            loop {
                let frame = match inbound.message().await {
                    Ok(Some(frame)) => frame,
                    Ok(None) => break,
                    Err(error) => {
                        let _ = tx
                            .send(Err(Status::internal(format!(
                                "读取 WSL Link duplex frame 失败：{error}"
                            ))))
                            .await;
                        break;
                    }
                };

                let response = match build_server_frame_with_state(&state, frame) {
                    Some(response) => response,
                    None => {
                        let _ = tx
                            .send(Err(Status::internal("WSL Link agent 状态锁已损坏。")))
                            .await;
                        break;
                    }
                };

                if tx.send(response).await.is_err() {
                    break;
                }
            }
        });

        Ok(Response::new(
            tonic::codegen::tokio_stream::wrappers::ReceiverStream::new(rx),
        ))
    }
}

fn build_server_frame_with_state(
    state: &Arc<Mutex<AgentState>>,
    frame: ClientFrame,
) -> Option<Result<ServerFrame, Status>> {
    let mut state = state.lock().ok()?;
    Some(build_server_frame(&mut state, frame))
}

fn build_server_frame(state: &mut AgentState, frame: ClientFrame) -> Result<ServerFrame, Status> {
    if frame.session_id.trim().is_empty() {
        return Err(Status::invalid_argument("session_id 不能为空。"));
    }
    if frame.request_id.trim().is_empty() {
        return Err(Status::invalid_argument("request_id 不能为空。"));
    }
    if frame.idempotency_key.trim().is_empty() {
        return Err(Status::invalid_argument("idempotency_key 不能为空。"));
    }

    let Some(session) = state.get_session_mut(&frame.session_id) else {
        return Err(Status::not_found("session 不存在。"));
    };
    if let Some(cached) = session
        .idempotency_cache
        .get(&frame.idempotency_key)
        .cloned()
    {
        session.ack_client_seq(frame.client_seq);
        let mut response = cached;
        response.ack_client_seq = session.ack_client_seq;
        return Ok(response);
    }

    session.ack_client_seq(frame.client_seq);
    let server_seq = session.next_server_seq();

    let response = ServerFrame {
        session_id: frame.session_id,
        request_id: frame.request_id,
        server_seq,
        ack_client_seq: session.ack_client_seq,
        payload: frame.payload,
        trace_id: frame.trace_id,
    };
    session
        .idempotency_cache
        .insert(frame.idempotency_key, response.clone());

    Ok(response)
}

#[cfg(test)]
mod tests {
    use tonic::Request;

    use super::*;

    fn open_request() -> OpenSessionRequest {
        OpenSessionRequest {
            client_id: "desktop".to_string(),
            protocol_version: DEFAULT_PROTOCOL_VERSION.to_string(),
            last_client_seq: 2,
            trace_id: "trace-1".to_string(),
        }
    }

    #[tokio::test]
    async fn open_session_returns_vsock_transport_and_ack() {
        let service = WslLinkAgentService::new();

        let response = service
            .open_session(Request::new(open_request()))
            .await
            .expect("open session should work")
            .into_inner();

        assert_eq!(response.ack_client_seq, 2);
        assert_eq!(response.transport, TransportKind::VsockGrpc as i32);
        assert!(!response.session_id.is_empty());
    }

    #[tokio::test]
    async fn resume_unknown_session_is_rejected_without_error() {
        let service = WslLinkAgentService::new();

        let response = service
            .resume_session(Request::new(ResumeSessionRequest {
                session_id: "missing".to_string(),
                last_ack_server_seq: 0,
                last_client_seq: 3,
                trace_id: "trace-2".to_string(),
            }))
            .await
            .expect("resume should return structured response")
            .into_inner();

        assert!(!response.accepted);
    }

    #[tokio::test]
    async fn heartbeat_advances_server_seq_and_ack() {
        let service = WslLinkAgentService::new();
        let open = service
            .open_session(Request::new(open_request()))
            .await
            .expect("open session should work")
            .into_inner();

        let heartbeat = service
            .heartbeat(Request::new(HeartbeatRequest {
                session_id: open.session_id,
                client_seq: 7,
                ack_server_seq: 0,
                sent_at_unix_ms: 1,
            }))
            .await
            .expect("heartbeat should work")
            .into_inner();

        assert_eq!(heartbeat.ack_client_seq, 7);
        assert!(heartbeat.server_seq > open.server_seq);
    }

    #[test]
    fn duplicate_duplex_frame_returns_cached_response() {
        let mut state = AgentState::default();
        let (session, _) = state.create_session(0);
        let frame = ClientFrame {
            session_id: session.session_id.clone(),
            request_id: "r1".to_string(),
            idempotency_key: "idem-1".to_string(),
            client_seq: 1,
            ack_server_seq: 0,
            payload: b"payload".to_vec(),
            trace_id: "trace-3".to_string(),
        };

        let first = build_server_frame(&mut state, frame.clone()).expect("first frame should work");
        let second = build_server_frame(&mut state, frame).expect("second frame should work");

        assert_eq!(first.payload, b"payload");
        assert_eq!(second.payload, b"payload");
        assert_eq!(second.server_seq, first.server_seq);
        assert_eq!(second.ack_client_seq, 1);
    }

    #[test]
    fn service_exposes_noise_responder_config_when_material_is_loaded() {
        let material = super::super::noise_material::generate_pairing_material()
            .expect("pairing material should generate");
        let service = WslLinkAgentService::with_noise_material(material.agent);

        assert!(service.noise_responder_config().is_some());
    }
}
