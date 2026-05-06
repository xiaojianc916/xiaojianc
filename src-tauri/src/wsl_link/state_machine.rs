use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WslLinkConnectionState {
    Idle,
    Connecting,
    Ready,
    Degraded,
    Reconnecting,
    Resuming,
    Backoff,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WslLinkEvent {
    Start,
    HandshakeOk,
    ConnectError,
    HeartbeatMiss,
    HeartbeatOk,
    HeartbeatDead,
    TransportOk,
    ResumeOk,
    ResumeError,
    BackoffElapsed,
    Stop,
}

#[derive(Debug, Error, PartialEq, Eq)]
#[error("WSL Link 非法状态转移：{from:?} + {event:?}")]
pub struct WslLinkStateError {
    pub from: WslLinkConnectionState,
    pub event: WslLinkEvent,
}

#[derive(Debug, Clone)]
pub struct WslLinkStateMachine {
    state: WslLinkConnectionState,
}

impl Default for WslLinkStateMachine {
    fn default() -> Self {
        Self {
            state: WslLinkConnectionState::Idle,
        }
    }
}

impl WslLinkStateMachine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn state(&self) -> WslLinkConnectionState {
        self.state
    }

    pub fn transition(
        &mut self,
        event: WslLinkEvent,
    ) -> Result<WslLinkConnectionState, WslLinkStateError> {
        use WslLinkConnectionState::*;
        use WslLinkEvent::*;

        let next = match (self.state, event) {
            (Idle, Start) => Connecting,
            (Connecting, HandshakeOk) => Ready,
            (Connecting, ConnectError) => Backoff,
            (Ready, HeartbeatMiss) => Degraded,
            (Ready, Stop) => Closed,
            (Degraded, HeartbeatOk) => Ready,
            (Degraded, HeartbeatDead) => Reconnecting,
            (Degraded, Stop) => Closed,
            (Reconnecting, TransportOk) => Resuming,
            (Reconnecting, ConnectError) => Backoff,
            (Reconnecting, Stop) => Closed,
            (Resuming, ResumeOk) => Ready,
            (Resuming, ResumeError) => Backoff,
            (Resuming, Stop) => Closed,
            (Backoff, BackoffElapsed) => Connecting,
            (Backoff, Stop) => Closed,
            (Closed, Start) => Connecting,
            (Closed, Stop) => Closed,
            _ => {
                return Err(WslLinkStateError {
                    from: self.state,
                    event,
                });
            }
        };

        self.state = next;
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnect_path_resumes_to_ready() {
        let mut machine = WslLinkStateMachine::new();

        assert_eq!(
            machine.transition(WslLinkEvent::Start),
            Ok(WslLinkConnectionState::Connecting),
        );
        assert_eq!(
            machine.transition(WslLinkEvent::HandshakeOk),
            Ok(WslLinkConnectionState::Ready),
        );
        assert_eq!(
            machine.transition(WslLinkEvent::HeartbeatMiss),
            Ok(WslLinkConnectionState::Degraded),
        );
        assert_eq!(
            machine.transition(WslLinkEvent::HeartbeatDead),
            Ok(WslLinkConnectionState::Reconnecting),
        );
        assert_eq!(
            machine.transition(WslLinkEvent::TransportOk),
            Ok(WslLinkConnectionState::Resuming),
        );
        assert_eq!(
            machine.transition(WslLinkEvent::ResumeOk),
            Ok(WslLinkConnectionState::Ready),
        );
    }

    #[test]
    fn illegal_transition_is_rejected() {
        let mut machine = WslLinkStateMachine::new();

        assert!(machine.transition(WslLinkEvent::ResumeOk).is_err());
        assert_eq!(machine.state(), WslLinkConnectionState::Idle);
    }
}
