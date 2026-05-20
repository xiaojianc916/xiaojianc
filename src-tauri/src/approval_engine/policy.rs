use super::decision::{ApprovalDecisionKind, ApprovalRequest};

pub fn default_decision_for_request(_request: &ApprovalRequest) -> ApprovalDecisionKind {
    ApprovalDecisionKind::Denied
}
