#![allow(dead_code)]

pub mod decision;
pub mod journal;
pub mod policy;

pub use decision::{ApprovalDecision, ApprovalRequest};

use chrono::Utc;
use std::path::Path;

pub fn deny_by_default(
    request: ApprovalRequest,
    storage_root: &Path,
    reason: Option<String>,
) -> Result<ApprovalDecision, String> {
    let kind = policy::default_decision_for_request(&request);
    let decision = ApprovalDecision {
        id: request.id,
        scope: request.scope,
        kind,
        reason,
        created_at: Utc::now().to_rfc3339(),
    };
    journal::append_decision(storage_root, &decision)?;
    Ok(decision)
}
