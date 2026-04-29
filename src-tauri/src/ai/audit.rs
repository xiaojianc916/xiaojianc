use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiAuditEventKind {
    ChatStarted,
    ChatCompleted,
    ChatFailed,
    AgentPlanCreated,
    AgentPlanApproved,
    ConfigUpdated,
    CredentialCleared,
    AiEditAuthChanged,
    AiEditApplied,
    AiEditCheckpointCreated,
    AiEditPruned,
    AiEditOperationReverted,
    AiEditFileReverted,
    AiEditHunkReverted,
    AiEditSnapshotRestored,
    AiEditTaskReverted,
    PatchProposed,
    PatchApplied,
    PatchFailed,
    SecretDetected,
}

pub fn emit(event: AiAuditEventKind) {
    tracing::info!(target: "ai.audit", event = ?event, "AI audit event");
}
