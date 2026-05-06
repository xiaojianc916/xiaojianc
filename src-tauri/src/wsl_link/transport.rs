use std::time::Duration;

use super::types::WslLinkTransportKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportLaunchDecision {
    pub primary: WslLinkTransportKind,
    pub fallback: Option<WslLinkTransportKind>,
}

#[derive(Debug, Clone)]
pub struct HedgedTransportPlanner {
    primary: WslLinkTransportKind,
    fallback: WslLinkTransportKind,
    hedged_after: Duration,
}

impl HedgedTransportPlanner {
    pub fn new(hedged_after: Duration) -> Self {
        Self {
            primary: WslLinkTransportKind::VsockGrpc,
            fallback: WslLinkTransportKind::MirroredQuic,
            hedged_after,
        }
    }

    pub fn plan(&self, elapsed: Duration, is_primary_degraded: bool) -> TransportLaunchDecision {
        let should_launch_fallback = is_primary_degraded || elapsed >= self.hedged_after;

        TransportLaunchDecision {
            primary: self.primary,
            fallback: should_launch_fallback.then_some(self.fallback),
        }
    }
}

impl Default for HedgedTransportPlanner {
    fn default() -> Self {
        Self::new(Duration::from_millis(250))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planner_waits_before_launching_fallback() {
        let planner = HedgedTransportPlanner::default();

        let decision = planner.plan(Duration::from_millis(100), false);

        assert_eq!(decision.primary, WslLinkTransportKind::VsockGrpc);
        assert_eq!(decision.fallback, None);
    }

    #[test]
    fn planner_launches_fallback_when_primary_is_slow() {
        let planner = HedgedTransportPlanner::default();

        let decision = planner.plan(Duration::from_millis(300), false);

        assert_eq!(decision.fallback, Some(WslLinkTransportKind::MirroredQuic));
    }

    #[test]
    fn planner_launches_fallback_when_primary_is_degraded() {
        let planner = HedgedTransportPlanner::default();

        let decision = planner.plan(Duration::from_millis(1), true);

        assert_eq!(decision.fallback, Some(WslLinkTransportKind::MirroredQuic));
    }
}
