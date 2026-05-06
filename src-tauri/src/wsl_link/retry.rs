use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BackoffPolicy {
    pub base: Duration,
    pub max: Duration,
    pub multiplier: f64,
    pub jitter_ratio: f64,
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self {
            base: Duration::from_millis(200),
            max: Duration::from_secs(5),
            multiplier: 2.0,
            jitter_ratio: 0.3,
        }
    }
}

impl BackoffPolicy {
    pub fn delay_for_attempt(&self, attempt: u32) -> Duration {
        let multiplier = self.multiplier.max(1.0).powi(attempt.min(20) as i32);
        let raw_ms = self.base.as_millis() as f64 * multiplier;
        let capped_ms = raw_ms.min(self.max.as_millis() as f64);
        let jitter = deterministic_jitter(attempt) * self.jitter_ratio.clamp(0.0, 1.0);
        let delayed_ms = (capped_ms * (1.0 + jitter)).clamp(1.0, self.max.as_millis() as f64);

        Duration::from_millis(delayed_ms.round() as u64)
    }
}

fn deterministic_jitter(attempt: u32) -> f64 {
    let mut value = u64::from(attempt).wrapping_add(0x9E37_79B9_7F4A_7C15);
    value ^= value >> 30;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^= value >> 31;

    let bucket = (value % 10_001) as f64 / 10_000.0;
    bucket * 2.0 - 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_is_capped() {
        let policy = BackoffPolicy::default();

        assert!(policy.delay_for_attempt(20) <= policy.max);
    }

    #[test]
    fn backoff_has_stable_jitter() {
        let policy = BackoffPolicy::default();

        assert_eq!(policy.delay_for_attempt(3), policy.delay_for_attempt(3));
        assert_ne!(policy.delay_for_attempt(3), policy.delay_for_attempt(4));
    }
}
