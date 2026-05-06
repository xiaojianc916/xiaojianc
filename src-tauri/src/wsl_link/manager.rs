use std::time::{Duration, Instant};

use serde::Serialize;
use thiserror::Error;

use super::{
    circuit_breaker::{CircuitBreaker, CircuitBreakerDecision},
    config::WslLinkTransportConfig,
    outbox::{WslLinkOutboxError, WslLinkWalOutbox},
    retry::BackoffPolicy,
    state_machine::{WslLinkConnectionState, WslLinkEvent, WslLinkStateError, WslLinkStateMachine},
    transport::HedgedTransportPlanner,
    types::{
        now_unix_ms, WslLinkEnvelope, WslLinkMetrics, WslLinkResumeFrame, WslLinkTransportKind,
    },
};

pub trait WslLinkTransportAdapter {
    fn kind(&self) -> WslLinkTransportKind;
    fn is_available(&self) -> bool;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkConnectPlan {
    pub primary: WslLinkTransportKind,
    pub fallback: Option<WslLinkTransportKind>,
    pub next_backoff_ms: u64,
    pub should_probe_primary: bool,
}

#[derive(Debug, Error)]
pub enum WslLinkManagerError {
    #[error("WSL Link 状态转移失败：{0}")]
    State(#[from] WslLinkStateError),
    #[error("WSL Link outbox 失败：{0}")]
    Outbox(#[from] WslLinkOutboxError),
}

#[derive(Debug)]
pub struct WslLinkManager {
    state_machine: WslLinkStateMachine,
    circuit_breaker: CircuitBreaker,
    hedged_planner: HedgedTransportPlanner,
    backoff_policy: BackoffPolicy,
    transport_config: WslLinkTransportConfig,
    metrics: WslLinkMetrics,
    connect_started_at: Option<Instant>,
    reconnect_attempt: u32,
    last_ack_server_seq: u64,
    last_client_seq: u64,
}

impl WslLinkManager {
    pub fn new(transport_config: WslLinkTransportConfig) -> Self {
        Self {
            state_machine: WslLinkStateMachine::new(),
            circuit_breaker: CircuitBreaker::default(),
            hedged_planner: HedgedTransportPlanner::new(transport_config.hedged_after),
            backoff_policy: BackoffPolicy::default(),
            transport_config,
            metrics: WslLinkMetrics {
                active_transport: None,
                rtt_ms: None,
                reconnects_total: 0,
                inflight_requests: 0,
                outbox_depth: 0,
                last_error: None,
            },
            connect_started_at: None,
            reconnect_attempt: 0,
            last_ack_server_seq: 0,
            last_client_seq: 0,
        }
    }

    pub fn state(&self) -> WslLinkConnectionState {
        self.state_machine.state()
    }

    pub fn metrics(&self) -> WslLinkMetrics {
        self.metrics.clone()
    }

    pub fn config(&self) -> WslLinkTransportConfig {
        self.transport_config
    }

    pub fn circuit_breaker_state(&self) -> super::circuit_breaker::CircuitBreakerState {
        self.circuit_breaker.state()
    }

    pub fn start_connecting(&mut self) -> Result<(), WslLinkManagerError> {
        self.state_machine.transition(WslLinkEvent::Start)?;
        self.connect_started_at = Some(Instant::now());
        Ok(())
    }

    pub fn begin_manual_connect_attempt(&mut self) -> Result<(), WslLinkManagerError> {
        match self.state() {
            WslLinkConnectionState::Idle | WslLinkConnectionState::Closed => {
                self.state_machine.transition(WslLinkEvent::Start)?;
            }
            WslLinkConnectionState::Backoff => {
                self.state_machine
                    .transition(WslLinkEvent::BackoffElapsed)?;
            }
            WslLinkConnectionState::Degraded => {
                self.state_machine.transition(WslLinkEvent::HeartbeatDead)?;
            }
            WslLinkConnectionState::Ready
            | WslLinkConnectionState::Connecting
            | WslLinkConnectionState::Reconnecting
            | WslLinkConnectionState::Resuming => {}
        }
        self.connect_started_at = Some(Instant::now());
        Ok(())
    }

    pub fn connect_plan(&mut self, now_unix_ms: u64) -> WslLinkConnectPlan {
        let should_probe_primary =
            self.circuit_breaker.before_call(now_unix_ms) == CircuitBreakerDecision::Allow;
        let elapsed = self
            .connect_started_at
            .map(|started_at| started_at.elapsed())
            .unwrap_or(Duration::ZERO);
        let decision = self.hedged_planner.plan(
            elapsed,
            self.state() == WslLinkConnectionState::Degraded || !should_probe_primary,
        );

        WslLinkConnectPlan {
            primary: decision.primary,
            fallback: decision.fallback,
            next_backoff_ms: self
                .backoff_policy
                .delay_for_attempt(self.reconnect_attempt)
                .as_millis()
                .min(u128::from(u64::MAX)) as u64,
            should_probe_primary,
        }
    }

    pub fn record_handshake_ok(
        &mut self,
        active_transport: WslLinkTransportKind,
    ) -> Result<(), WslLinkManagerError> {
        self.circuit_breaker.record_success();
        self.metrics.active_transport = Some(active_transport);
        self.metrics.last_error = None;
        self.reconnect_attempt = 0;

        match self.state() {
            WslLinkConnectionState::Connecting => {
                self.state_machine.transition(WslLinkEvent::HandshakeOk)?;
            }
            WslLinkConnectionState::Reconnecting => {
                self.state_machine.transition(WslLinkEvent::TransportOk)?;
            }
            _ => {}
        }

        Ok(())
    }

    pub fn record_connect_error(
        &mut self,
        error_message: impl Into<String>,
    ) -> Result<(), WslLinkManagerError> {
        self.metrics.last_error = Some(error_message.into());
        self.metrics.active_transport = None;
        self.metrics.reconnects_total = self.metrics.reconnects_total.saturating_add(1);
        self.reconnect_attempt = self.reconnect_attempt.saturating_add(1);
        self.circuit_breaker.record_failure(now_unix_ms());

        match self.state() {
            WslLinkConnectionState::Connecting | WslLinkConnectionState::Reconnecting => {
                self.state_machine.transition(WslLinkEvent::ConnectError)?;
            }
            WslLinkConnectionState::Resuming => {
                self.state_machine.transition(WslLinkEvent::ResumeError)?;
            }
            _ => {}
        }

        Ok(())
    }

    pub fn mark_heartbeat_miss(&mut self) -> Result<(), WslLinkManagerError> {
        if self.state() == WslLinkConnectionState::Ready {
            self.state_machine.transition(WslLinkEvent::HeartbeatMiss)?;
        }
        Ok(())
    }

    pub fn mark_heartbeat_dead(&mut self) -> Result<(), WslLinkManagerError> {
        if self.state() == WslLinkConnectionState::Degraded {
            self.state_machine.transition(WslLinkEvent::HeartbeatDead)?;
            self.connect_started_at = Some(Instant::now());
        }
        Ok(())
    }

    pub fn mark_resumed(&mut self) -> Result<(), WslLinkManagerError> {
        if self.state() == WslLinkConnectionState::Resuming {
            self.state_machine.transition(WslLinkEvent::ResumeOk)?;
        }
        Ok(())
    }

    pub fn resume_frame(&self, session_id: impl Into<String>) -> WslLinkResumeFrame {
        WslLinkResumeFrame {
            session_id: session_id.into(),
            last_ack_server_seq: self.last_ack_server_seq,
            last_client_seq: self.last_client_seq,
        }
    }

    pub fn enqueue_outbox(
        &mut self,
        outbox: &WslLinkWalOutbox,
        envelope: &WslLinkEnvelope,
    ) -> Result<(), WslLinkManagerError> {
        outbox.enqueue(envelope)?;
        self.last_client_seq = self.last_client_seq.max(envelope.client_seq);
        self.last_ack_server_seq = self.last_ack_server_seq.max(envelope.ack_server_seq);
        self.metrics.outbox_depth = outbox.pending()?.len() as u64;
        Ok(())
    }

    pub fn ack_outbox(
        &mut self,
        outbox: &WslLinkWalOutbox,
        ack_client_seq: u64,
        server_seq: u64,
    ) -> Result<(), WslLinkManagerError> {
        outbox.ack(ack_client_seq)?;
        self.last_ack_server_seq = self.last_ack_server_seq.max(server_seq);
        self.metrics.outbox_depth = outbox.pending()?.len() as u64;
        Ok(())
    }
}

impl Default for WslLinkManager {
    fn default() -> Self {
        Self::new(WslLinkTransportConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn unique_outbox_path() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("calamex-wsl-link-manager-{stamp}.jsonl"))
    }

    fn envelope(client_seq: u64) -> WslLinkEnvelope {
        WslLinkEnvelope {
            session_id: "s1".to_string(),
            request_id: format!("r{client_seq}"),
            idempotency_key: format!("idem-{client_seq}"),
            client_seq,
            ack_server_seq: 0,
            trace_id: format!("trace-{client_seq}"),
            payload: b"payload".to_vec(),
            created_at_unix_ms: client_seq,
        }
    }

    #[test]
    fn manager_builds_hedged_plan_after_threshold() {
        let mut manager = WslLinkManager::default();
        manager.start_connecting().expect("start should work");
        std::thread::sleep(Duration::from_millis(260));

        let plan = manager.connect_plan(now_unix_ms());

        assert_eq!(plan.primary, WslLinkTransportKind::VsockGrpc);
        assert_eq!(plan.fallback, Some(WslLinkTransportKind::MirroredQuic));
    }

    #[test]
    fn manager_records_resume_ack_state_for_outbox() {
        let path = unique_outbox_path();
        let outbox = WslLinkWalOutbox::open(&path).expect("outbox should open");
        let mut manager = WslLinkManager::default();

        manager
            .enqueue_outbox(&outbox, &envelope(1))
            .expect("enqueue should work");
        manager.ack_outbox(&outbox, 1, 7).expect("ack should work");

        let resume = manager.resume_frame("s1");

        assert_eq!(resume.last_ack_server_seq, 7);
        assert_eq!(resume.last_client_seq, 1);
        assert_eq!(manager.metrics().outbox_depth, 0);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn manager_opens_circuit_after_repeated_connect_errors() {
        let mut manager = WslLinkManager::default();
        manager.start_connecting().expect("start should work");
        manager
            .record_connect_error("connect failed")
            .expect("first error should work");
        assert_eq!(manager.state(), WslLinkConnectionState::Backoff);

        let plan = manager.connect_plan(now_unix_ms());

        assert!(plan.next_backoff_ms >= 1);
    }

    #[test]
    fn manager_manual_attempt_retries_from_backoff() {
        let mut manager = WslLinkManager::default();
        manager.start_connecting().expect("start should work");
        manager
            .record_connect_error("connect failed")
            .expect("error should record");

        manager
            .begin_manual_connect_attempt()
            .expect("manual retry should work");

        assert_eq!(manager.state(), WslLinkConnectionState::Connecting);
    }
}
