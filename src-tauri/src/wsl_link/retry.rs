use backon::{BackoffBuilder, ExponentialBuilder};
use std::time::Duration;

/// 指数退避策略，基于 ackon crate。
///
/// 同一 ttempt 输入始终返回相同延迟（未启用 jitter），
/// 通过 ackon 的 seed 保证确定性。
#[derive(Debug, Clone)]
pub struct BackoffPolicy {
    min_delay: Duration,
    max_delay: Duration,
    factor: f32,
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self {
            min_delay: Duration::from_millis(200),
            max_delay: Duration::from_secs(5),
            factor: 2.0,
        }
    }
}

impl BackoffPolicy {
    pub fn delay_for_attempt(&self, attempt: u32) -> Duration {
        let mut backoff = ExponentialBuilder::default()
            .with_min_delay(self.min_delay)
            .with_max_delay(self.max_delay)
            .with_factor(self.factor)
            .with_max_times(usize::MAX)
            .build();

        for _ in 0..attempt {
            backoff.next();
        }
        backoff.next().unwrap_or(self.max_delay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_is_capped() {
        let policy = BackoffPolicy::default();
        assert!(policy.delay_for_attempt(20) <= policy.max_delay);
    }

    #[test]
    fn backoff_is_stable() {
        let policy = BackoffPolicy::default();
        assert_eq!(policy.delay_for_attempt(3), policy.delay_for_attempt(3));
        assert_ne!(policy.delay_for_attempt(3), policy.delay_for_attempt(4));
    }
}