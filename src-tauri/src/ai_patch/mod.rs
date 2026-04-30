pub mod apply;
pub mod parser;
pub mod preview;
pub mod rollback;
pub mod validator;

use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::errors;
use crate::ai_edit::auto_apply::{self, AiAutoApplyOperationKind, AiAutoApplyOperationPlan};
use crate::ai_edit::protected_paths;
use crate::ai_edit::AiEditState;
use crate::commands::contracts::{
    AiAgentChangedFilePayload, AiAgentPatchSummaryPayload, AiApplyPatchFilePayload,
    AiApplyPatchMetadataRequest, AiApplyPatchPayload, AiApplyPatchRequest, AiPatchFilePayload,
    AiPatchHunkPayload, AiPatchSetPayload, AiProposePatchPayload, AiProposePatchRequest,
};
use std::fs;
use std::path::{Path, PathBuf};

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;
const AED_DIFF_REF_PREFIX: &str = "aed-diff:";
const AED_PATCH_REF_PREFIX: &str = "aed-patch:";

pub fn propose_patch(payload: AiProposePatchRequest) -> Result<AiProposePatchPayload, String> {
    if payload.path.trim().is_empty() {
        return Err(errors::error(
            "AI_PATCH_INVALID",
            "Patch 文件路径不能为空。",
        ));
    }
    if payload.original_content == payload.updated_content {
        return Err(errors::error("AI_PATCH_INVALID", "Patch 内容没有变化。"));
    }

    let old_lines = count_lines(&payload.original_content);
    let new_lines = count_lines(&payload.updated_content);
    let lines = build_full_replace_lines(&payload.original_content, &payload.updated_content);
    let patch = AiPatchSetPayload {
        summary: payload.summary.trim().to_string(),
        files: vec![AiPatchFilePayload {
            path: payload.path,
            original_hash: hash_text(&payload.original_content),
            hunks: vec![AiPatchHunkPayload {
                old_start: 1,
                old_lines,
                new_start: 1,
                new_lines,
                lines,
            }],
        }],
    };
    audit::emit(AiAuditEventKind::PatchProposed);
    Ok(AiProposePatchPayload { patch })
}

struct PendingPatchFile {
    payload_path: String,
    original_hash: String,
    original: String,
    updated: String,
}

pub fn apply_patch(
    payload: AiApplyPatchRequest,
    state: &AiEditState,
    snapshot_root: &Path,
) -> Result<AiApplyPatchPayload, String> {
    validate_patch(&payload.patch)?;
    let metadata = payload.metadata;
    let patch = payload.patch;
    let mut pending_files = Vec::with_capacity(patch.files.len());

    for file in &patch.files {
        let path = PathBuf::from(&file.path);
        validate_writable_path(&path)?;
        let original = fs::read_to_string(&path).map_err(|error| {
            errors::error("AI_PATCH_CONFLICT", format!("读取待应用文件失败：{error}"))
        })?;
        if hash_text(&original) != file.original_hash {
            audit::emit(AiAuditEventKind::PatchFailed);
            return Err(errors::error(
                "AI_PATCH_CONFLICT",
                format!("文件已变化，拒绝应用 Patch：{}", file.path),
            ));
        }
        let updated = apply_file_patch(file)?;
        pending_files.push(PendingPatchFile {
            payload_path: file.path.clone(),
            original_hash: file.original_hash.clone(),
            original,
            updated,
        });
    }

    let operation_plans = pending_files
        .iter()
        .map(|file| AiAutoApplyOperationPlan {
            kind: AiAutoApplyOperationKind::Modify,
            path: file.payload_path.clone(),
            new_path: None,
            original_hash: Some(file.original_hash.clone()),
            original_content: Some(file.original.clone()),
            updated_content: Some(file.updated.clone()),
        })
        .collect::<Vec<_>>();

    let applied_files = match auto_apply::apply_operation_plans(
        &operation_plans,
        metadata.as_ref(),
        &patch.summary,
        state,
        snapshot_root,
    ) {
        Ok(result) => result,
        Err(error) => {
            audit::emit(AiAuditEventKind::PatchFailed);
            return Err(error);
        }
    };

    let applied_files = applied_files
        .into_iter()
        .map(|file| AiApplyPatchFilePayload {
            path: file.path,
            byte_size: file.byte_size,
        })
        .collect::<Vec<_>>();

    if applied_files.is_empty() {
        audit::emit(AiAuditEventKind::PatchFailed);
        return Err(errors::error(
            "AI_PATCH_APPLY_FAILED",
            "Patch 未产生任何写入结果。",
        ));
    }

    tracing::info!(
        target: "ai.audit",
        event = "ai.edit.applied",
        task_id = metadata
            .as_ref()
            .and_then(|value| value.task_id.as_deref())
            .unwrap_or(""),
        turn_id = metadata
            .as_ref()
            .and_then(|value| value.turn_id.as_deref())
            .unwrap_or(""),
        file_count = applied_files.len(),
        byte_size_total = applied_files.iter().map(|file| file.byte_size).sum::<u64>(),
        "AI edit applied"
    );
    audit::emit(AiAuditEventKind::AiEditApplied);
    audit::emit(AiAuditEventKind::PatchApplied);
    Ok(AiApplyPatchPayload { applied_files })
}

pub fn hash_text(value: &str) -> String {
    let mut hash = FNV_OFFSET;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("fnv64:{hash:016x}")
}

pub fn build_agent_patch_summary(
    patch: &AiPatchSetPayload,
    applied_files: &[AiApplyPatchFilePayload],
    metadata: &AiApplyPatchMetadataRequest,
    applied_at: String,
    seq: u64,
) -> Option<AiAgentPatchSummaryPayload> {
    let task_id = metadata.task_id.as_deref()?.trim();
    let run_id = metadata.agent_run_id.as_deref()?.trim();
    let step_id = metadata.agent_step_id.as_deref()?.trim();

    if task_id.is_empty() || run_id.is_empty() || step_id.is_empty() || applied_files.is_empty() {
        return None;
    }

    let files = patch
        .files
        .iter()
        .filter(|file| {
            applied_files
                .iter()
                .any(|applied_file| paths_equal(&applied_file.path, &file.path))
        })
        .map(|file| {
            let (additions, deletions) = count_patch_file_stats(file);
            AiAgentChangedFilePayload {
                path: file.path.clone(),
                status: infer_changed_file_status(file, additions, deletions),
                additions,
                deletions,
                diff_ref: build_aed_diff_ref(task_id, &file.path),
                rollback_ref: None,
            }
        })
        .collect::<Vec<_>>();

    if files.is_empty() {
        return None;
    }

    let total_additions = files.iter().map(|file| file.additions).sum::<u32>();
    let total_deletions = files.iter().map(|file| file.deletions).sum::<u32>();

    Some(AiAgentPatchSummaryPayload {
        id: format!("patch-summary:{run_id}:{step_id}:{seq}"),
        run_id: run_id.to_string(),
        step_id: step_id.to_string(),
        files,
        total_additions,
        total_deletions,
        patch_ref: format!("{AED_PATCH_REF_PREFIX}{}", percent_encode(task_id)),
        applied_at: Some(applied_at),
        reverted_at: None,
    })
}

fn count_patch_file_stats(file: &AiPatchFilePayload) -> (u32, u32) {
    file.hunks.iter().flat_map(|hunk| hunk.lines.iter()).fold(
        (0, 0),
        |(additions, deletions), line| {
            if line.starts_with('+') && !line.starts_with("+++") {
                (additions + 1, deletions)
            } else if line.starts_with('-') && !line.starts_with("---") {
                (additions, deletions + 1)
            } else {
                (additions, deletions)
            }
        },
    )
}

fn infer_changed_file_status(file: &AiPatchFilePayload, additions: u32, deletions: u32) -> String {
    if additions > 0 && deletions == 0 && file.hunks.iter().all(|hunk| hunk.old_lines == 0) {
        return "added".to_string();
    }

    if deletions > 0 && additions == 0 && file.hunks.iter().all(|hunk| hunk.new_lines == 0) {
        return "deleted".to_string();
    }

    "modified".to_string()
}

fn build_aed_diff_ref(task_id: &str, path: &str) -> String {
    format!(
        "{AED_DIFF_REF_PREFIX}{}:{}",
        percent_encode(task_id),
        percent_encode(path)
    )
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();

    for byte in value.as_bytes() {
        let is_unreserved =
            byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.' | b'~');

        if is_unreserved {
            encoded.push(char::from(*byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }

    encoded
}

fn normalize_compare_path(value: &str) -> String {
    let replaced = value.replace('\\', "/");
    let stripped = replaced
        .strip_prefix("//?/UNC/")
        .map(|rest| format!("//{rest}"))
        .or_else(|| replaced.strip_prefix("//?/").map(|rest| rest.to_string()))
        .unwrap_or(replaced);

    stripped.trim_end_matches('/').to_lowercase()
}

fn paths_equal(left: &str, right: &str) -> bool {
    normalize_compare_path(left) == normalize_compare_path(right)
}

fn validate_patch(patch: &AiPatchSetPayload) -> Result<(), String> {
    if patch.files.is_empty() {
        return Err(errors::error(
            "AI_PATCH_INVALID",
            "Patch 至少需要包含一个文件。",
        ));
    }
    if patch.files.len() > 20 {
        return Err(errors::error(
            "AI_PATCH_INVALID",
            "单次 Patch 文件数量过多。",
        ));
    }
    for file in &patch.files {
        if file.path.trim().is_empty()
            || file.original_hash.trim().is_empty()
            || file.hunks.is_empty()
        {
            return Err(errors::error("AI_PATCH_INVALID", "Patch 文件信息不完整。"));
        }
    }
    Ok(())
}

fn validate_writable_path(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(errors::error("AI_PATCH_CONFLICT", "Patch 目标文件不存在。"));
    }
    let value = path.to_string_lossy().replace('\\', "/");
    if protected_paths::is_builtin_protected_path(&value) {
        return Err(errors::error(
            "AI_EDIT_PATH_PROTECTED",
            "AED 受保护路径需要显式二次确认，当前 Patch 已被拒绝。",
        ));
    }
    Ok(())
}

fn apply_file_patch(file: &AiPatchFilePayload) -> Result<String, String> {
    let mut output = Vec::new();
    for hunk in &file.hunks {
        for line in &hunk.lines {
            if let Some(rest) = line.strip_prefix('+') {
                output.push(rest.to_string());
            } else if let Some(rest) = line.strip_prefix(' ') {
                output.push(rest.to_string());
            } else if line.starts_with('-') {
                continue;
            } else {
                return Err(errors::error(
                    "AI_PATCH_INVALID",
                    "Patch 行必须以空格、+ 或 - 开头。",
                ));
            }
        }
    }
    Ok(output.join("\n"))
}

fn build_full_replace_lines(original: &str, updated: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for line in original.lines() {
        lines.push(format!("-{line}"));
    }
    for line in updated.lines() {
        lines.push(format!("+{line}"));
    }
    if updated.ends_with('\n') {
        lines.push("+".to_string());
    }
    lines
}

fn count_lines(value: &str) -> u32 {
    value.lines().count().max(1) as u32
}

#[cfg(test)]
mod tests {
    use super::{
        apply_patch, build_agent_patch_summary, hash_text, propose_patch, validate_writable_path,
    };
    use crate::ai_edit::{self, edit_journal, AiEditState};
    use crate::commands::contracts::{
        AiApplyPatchFilePayload, AiApplyPatchMetadataRequest, AiApplyPatchRequest,
        AiEditListTimelineRequest, AiEditSetAuthLevelRequest, AiEditTimelineEntryPayload,
        AiPatchFilePayload, AiPatchHunkPayload, AiPatchSetPayload, AiProposePatchRequest,
    };
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn propose_patch_uses_original_hash() {
        let payload = propose_patch(AiProposePatchRequest {
            path: "a.sh".to_string(),
            original_content: "echo old".to_string(),
            updated_content: "echo new".to_string(),
            summary: "更新输出".to_string(),
        })
        .expect("patch should be generated");
        assert_eq!(payload.patch.files[0].original_hash, hash_text("echo old"));
    }

    #[test]
    fn validate_writable_path_rejects_protected_targets() {
        let temp_dir = std::env::temp_dir().join(format!(
            "aed-ai-patch-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        let protected_dir = temp_dir.join("repo");
        let protected_path = protected_dir.join("Cargo.lock");

        fs::create_dir_all(&protected_dir).expect("temp directory should be created");
        fs::write(&protected_path, "lock").expect("temp file should be written");

        let error = validate_writable_path(&PathBuf::from(&protected_path))
            .expect_err("protected path should be rejected");
        assert!(error.contains("AI_EDIT_PATH_PROTECTED"));

        let _ = fs::remove_file(&protected_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn apply_patch_records_operation_into_ai_edit_timeline() {
        let temp_dir = std::env::temp_dir().join(format!(
            "aed-ai-patch-record-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        let file_path = temp_dir.join("script.sh");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&file_path, "echo old").expect("temp file should be written");

        let state = AiEditState::default();
        ai_edit::set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "session".to_string(),
                task_id: None,
            },
            &state,
        )
        .expect("session auth should be set");
        let snapshot_root = temp_dir.join("snapshot-store");
        let result = apply_patch(
            AiApplyPatchRequest {
                patch: AiPatchSetPayload {
                    summary: "应用 AI 代码块".to_string(),
                    files: vec![AiPatchFilePayload {
                        path: file_path.to_string_lossy().to_string(),
                        original_hash: hash_text("echo old"),
                        hunks: vec![AiPatchHunkPayload {
                            old_start: 1,
                            old_lines: 1,
                            new_start: 1,
                            new_lines: 1,
                            lines: vec!["-echo old".to_string(), "+echo new".to_string()],
                        }],
                    }],
                },
                metadata: None,
            },
            &state,
            &snapshot_root,
        )
        .expect("patch should apply");

        let timeline = ai_edit::list_timeline_with_state(
            AiEditListTimelineRequest {
                task_id: None,
                limit: None,
            },
            &state,
            Vec::new(),
            edit_journal::list_operations(&snapshot_root).expect("operations should be listed"),
        )
        .expect("timeline should be listed");

        assert_eq!(result.applied_files.len(), 1);
        assert_eq!(timeline.entries.len(), 3);
        assert!(matches!(
            timeline.entries[0],
            AiEditTimelineEntryPayload::Operation(_)
        ));
        assert!(matches!(
            timeline.entries[1],
            AiEditTimelineEntryPayload::Snapshot(_)
        ));
        assert!(matches!(
            timeline.entries[2],
            AiEditTimelineEntryPayload::Snapshot(_)
        ));
        if let AiEditTimelineEntryPayload::Operation(operation) = &timeline.entries[0] {
            assert!(operation.source_snapshot_id.is_some());
        }

        let _ = fs::remove_file(&file_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn apply_patch_rejects_manual_auth_mode() {
        let temp_dir = std::env::temp_dir().join(format!(
            "aed-ai-patch-manual-auth-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        let file_path = temp_dir.join("script.sh");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&file_path, "echo old").expect("temp file should be written");

        let state = AiEditState::default();
        let snapshot_root = temp_dir.join("snapshot-store");
        let error = apply_patch(
            AiApplyPatchRequest {
                patch: AiPatchSetPayload {
                    summary: "应用 AI 代码块".to_string(),
                    files: vec![AiPatchFilePayload {
                        path: file_path.to_string_lossy().to_string(),
                        original_hash: hash_text("echo old"),
                        hunks: vec![AiPatchHunkPayload {
                            old_start: 1,
                            old_lines: 1,
                            new_start: 1,
                            new_lines: 1,
                            lines: vec!["-echo old".to_string(), "+echo new".to_string()],
                        }],
                    }],
                },
                metadata: Some(AiApplyPatchMetadataRequest {
                    task_id: Some("task-1".to_string()),
                    turn_id: Some("turn-1".to_string()),
                    reason: None,
                    tool_call_id: None,
                    confirmed_by_user: None,
                    agent_run_id: None,
                    agent_step_id: None,
                }),
            },
            &state,
            &snapshot_root,
        )
        .expect_err("manual mode should block patch apply");

        assert!(error.contains("AI_EDIT_AUTH_BLOCKED"));
        assert_eq!(
            fs::read_to_string(&file_path).expect("file should still exist"),
            "echo old"
        );

        let _ = fs::remove_file(&file_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn apply_patch_allows_session_auth_mode() {
        let temp_dir = std::env::temp_dir().join(format!(
            "aed-ai-patch-session-auth-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        let file_path = temp_dir.join("script.sh");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&file_path, "echo old").expect("temp file should be written");

        let state = AiEditState::default();
        ai_edit::set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "session".to_string(),
                task_id: None,
            },
            &state,
        )
        .expect("session auth should be set");
        let snapshot_root = temp_dir.join("snapshot-store");

        let result = apply_patch(
            AiApplyPatchRequest {
                patch: AiPatchSetPayload {
                    summary: "应用 AI 代码块".to_string(),
                    files: vec![AiPatchFilePayload {
                        path: file_path.to_string_lossy().to_string(),
                        original_hash: hash_text("echo old"),
                        hunks: vec![AiPatchHunkPayload {
                            old_start: 1,
                            old_lines: 1,
                            new_start: 1,
                            new_lines: 1,
                            lines: vec!["-echo old".to_string(), "+echo new".to_string()],
                        }],
                    }],
                },
                metadata: Some(AiApplyPatchMetadataRequest {
                    task_id: Some("task-1".to_string()),
                    turn_id: Some("turn-1".to_string()),
                    reason: None,
                    tool_call_id: None,
                    confirmed_by_user: None,
                    agent_run_id: None,
                    agent_step_id: None,
                }),
            },
            &state,
            &snapshot_root,
        )
        .expect("session mode should allow patch apply");

        assert_eq!(result.applied_files.len(), 1);
        assert_eq!(
            fs::read_to_string(&file_path).expect("patched file should exist"),
            "echo new"
        );

        let _ = fs::remove_file(&file_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn apply_patch_allows_user_confirmed_manual_mode() {
        let temp_dir = std::env::temp_dir().join(format!(
            "aed-ai-patch-manual-confirm-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        let file_path = temp_dir.join("script.sh");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&file_path, "echo old").expect("temp file should be written");

        let state = AiEditState::default();
        let snapshot_root = temp_dir.join("snapshot-store");

        let result = apply_patch(
            AiApplyPatchRequest {
                patch: AiPatchSetPayload {
                    summary: "应用 AI 代码块".to_string(),
                    files: vec![AiPatchFilePayload {
                        path: file_path.to_string_lossy().to_string(),
                        original_hash: hash_text("echo old"),
                        hunks: vec![AiPatchHunkPayload {
                            old_start: 1,
                            old_lines: 1,
                            new_start: 1,
                            new_lines: 1,
                            lines: vec!["-echo old".to_string(), "+echo new".to_string()],
                        }],
                    }],
                },
                metadata: Some(AiApplyPatchMetadataRequest {
                    task_id: Some("task-1".to_string()),
                    turn_id: Some("turn-1".to_string()),
                    reason: None,
                    tool_call_id: None,
                    confirmed_by_user: Some(true),
                    agent_run_id: None,
                    agent_step_id: None,
                }),
            },
            &state,
            &snapshot_root,
        )
        .expect("manual mode should allow user confirmed patch apply");

        assert_eq!(result.applied_files.len(), 1);
        assert_eq!(
            fs::read_to_string(&file_path).expect("patched file should exist"),
            "echo new"
        );

        let _ = fs::remove_file(&file_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn build_agent_patch_summary_uses_refs_and_stats_without_patch_body() {
        let patch = AiPatchSetPayload {
            summary: "更新 Agent 文件".to_string(),
            files: vec![AiPatchFilePayload {
                path: "D:/workspace/src/App.vue".to_string(),
                original_hash: "fnv64:test".to_string(),
                hunks: vec![AiPatchHunkPayload {
                    old_start: 1,
                    old_lines: 2,
                    new_start: 1,
                    new_lines: 3,
                    lines: vec![
                        "--- a/src/App.vue".to_string(),
                        "+++ b/src/App.vue".to_string(),
                        " const a = 1;".to_string(),
                        "-const oldValue = true;".to_string(),
                        "+const nextValue = true;".to_string(),
                        "+const enabled = true;".to_string(),
                    ],
                }],
            }],
        };
        let metadata = AiApplyPatchMetadataRequest {
            task_id: Some("thread:1".to_string()),
            turn_id: Some("turn-1".to_string()),
            reason: None,
            tool_call_id: None,
            confirmed_by_user: Some(true),
            agent_run_id: Some("run-1".to_string()),
            agent_step_id: Some("step-1".to_string()),
        };
        let summary = build_agent_patch_summary(
            &patch,
            &[AiApplyPatchFilePayload {
                path: r"\\?\D:\workspace\src\App.vue".to_string(),
                byte_size: 128,
            }],
            &metadata,
            "2026-04-29T10:00:00Z".to_string(),
            7,
        )
        .expect("summary should be built");

        assert_eq!(summary.id, "patch-summary:run-1:step-1:7");
        assert_eq!(summary.run_id, "run-1");
        assert_eq!(summary.step_id, "step-1");
        assert_eq!(summary.total_additions, 2);
        assert_eq!(summary.total_deletions, 1);
        assert_eq!(summary.patch_ref, "aed-patch:thread%3A1");
        assert_eq!(summary.files.len(), 1);
        assert_eq!(
            summary.files[0].diff_ref,
            "aed-diff:thread%3A1:D%3A%2Fworkspace%2Fsrc%2FApp.vue"
        );
    }
}
