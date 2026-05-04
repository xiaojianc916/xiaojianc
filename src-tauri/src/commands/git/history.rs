use super::*;

#[tauri::command]
pub fn list_git_commit_history(
    payload: GitCommitHistoryRequest,
) -> Result<GitCommitHistoryPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    if resolve_head_commit(&repository)?.is_none() {
        return Ok(GitCommitHistoryPayload {
            entries: Vec::new(),
            has_more: false,
            next_offset: None,
        });
    }

    let offset = payload.offset.unwrap_or(0);
    let limit = payload
        .limit
        .unwrap_or(DEFAULT_GIT_HISTORY_LIMIT)
        .clamp(1, MAX_GIT_HISTORY_LIMIT);
    let mut revwalk = repository
        .revwalk()
        .map_err(|error| format!("读取 Git 提交历史失败：{error}"))?;
    revwalk
        .push_head()
        .map_err(|error| format!("读取 Git HEAD 历史失败：{error}"))?;
    revwalk
        .set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)
        .map_err(|error| format!("设置 Git 提交历史排序失败：{error}"))?;

    let mut entries = Vec::new();
    let mut has_more = false;
    for oid_result in revwalk.skip(offset) {
        let oid = oid_result.map_err(|error| format!("遍历 Git 提交历史失败：{error}"))?;
        let commit = repository
            .find_commit(oid)
            .map_err(|error| format!("读取 Git 提交失败：{error}"))?;

        if entries.len() >= limit {
            has_more = true;
            break;
        }

        entries.push(build_git_commit_summary(&commit));
    }

    Ok(GitCommitHistoryPayload {
        entries,
        has_more,
        next_offset: has_more.then_some(offset + limit),
    })
}
