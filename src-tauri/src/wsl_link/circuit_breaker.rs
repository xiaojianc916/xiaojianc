use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CircuitBreakerState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitBreakerDecision {
    Allow,
    Reject,
}

#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    state: CircuitBreakerState,
    failure_count: u32,
    failure_threshold: u32,
    opened_at_unix_ms: Option<u64>,
    open_timeout_ms: u64,
}

impl CircuitBreaker {
    pub fn new(failure_threshold: u32, open_timeout_ms: u64) -> Self {
        Self {
            state: CircuitBreakerState::Closed,
            failure_count: 0,
            failure_threshold: failure_threshold.max(1),
            opened_at_unix_ms: None,
            open_timeout_ms,
        }
    }

    pub fn state(&self) -> CircuitBreakerState {
        self.state
    }

    pub fn before_call(&mut self, now_unix_ms: u64) -> CircuitBreakerDecision {
        if self.state == CircuitBreakerState::Open {
            let elapsed = self
                .opened_at_unix_ms
                .map(|opened_at| now_unix_ms.saturating_sub(opened_at))
                .unwrap_or(0);

            if elapsed >= self.open_timeout_ms {
                self.state = CircuitBreakerState::HalfOpen;
                return CircuitBreakerDecision::Allow;
            }

            return CircuitBreakerDecision::Reject;
        }

        CircuitBreakerDecision::Allow
    }

    pub fn record_success(&mut self) {
        self.state = CircuitBreakerState::Closed;
        self.failure_count = 0;
        self.opened_at_unix_ms = None;
    }

    pub fn record_failure(&mut self, now_unix_ms: u64) {
        self.failure_count = self.failure_count.saturating_add(1);
        if self.state == CircuitBreakerState::HalfOpen
            || self.failure_count >= self.failure_threshold
        {
            self.state = CircuitBreakerState::Open;
            self.opened_at_unix_ms = Some(now_unix_ms);
        }
    }
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new(3, 30_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breaker_opens_after_threshold() {
        let mut breaker = CircuitBreaker::new(2, 1_000);

        breaker.record_failure(10);
        assert_eq!(breaker.state(), CircuitBreakerState::Closed);

        breaker.record_failure(20);
        assert_eq!(breaker.state(), CircuitBreakerState::Open);
        assert_eq!(breaker.before_call(30), CircuitBreakerDecision::Reject);
    }

    #[test]
    fn breaker_half_opens_after_timeout() {
        let mut breaker = CircuitBreaker::new(1, 1_000);

        breaker.record_failure(10);

        assert_eq!(breaker.before_call(1_010), CircuitBreakerDecision::Allow);
        assert_eq!(breaker.state(), CircuitBreakerState::HalfOpen);

        breaker.record_success();
        assert_eq!(breaker.state(), CircuitBreakerState::Closed);
    }
}
