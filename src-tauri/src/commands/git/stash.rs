use super::*;

#[tauri::command]
pub fn list_git_stashes(payload: GitRepositoryRootRequest) -> Result<GitStashListPayload, String> {
    let mut repository = open_repository_from_root(&payload.repository_root_path)?;
    let mut entries = Vec::new();

    repository
        .stash_foreach(|index, name, oid| {
            let (branch_name, commit_short_id) = parse_git_stash_name(name);
            entries.push(GitStashEntryPayload {
                index,
                stash_id: format!("stash@{{{index}}}"),
                summary: name.to_string(),
                branch_name,
                commit_short_id: commit_short_id.or_else(|| Some(short_commit_id(*oid))),
            });
            true
        })
        .map_err(|error| format!("读取 Git 贮藏列表失败：{error}"))?;

    Ok(GitStashListPayload { entries })
}

#[tauri::command]
pub fn save_git_stash(payload: GitStashSaveRequest) -> Result<GitRepositoryStatusPayload, String> {
    let mut repository = open_repository_from_root(&payload.repository_root_path)?;
    let status = super::status::build_git_repository_status_payload(&repository)?;
    if status.is_clean {
        return Err("当前没有可贮藏的改动。".into());
    }
    if status.conflicted_count > 0 {
        return Err("存在冲突文件，解决冲突后再执行贮藏。".into());
    }

    let signature = repository.signature().map_err(|error| {
        format!("读取 Git 贮藏身份失败：{error}。请先配置 user.name 和 user.email。")
    })?;
    let message = payload
        .message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let flags = payload
        .include_untracked
        .then_some(StashFlags::INCLUDE_UNTRACKED);
    repository
        .stash_save2(&signature, message, flags)
        .map_err(|error| format!("保存 Git 贮藏失败：{error}"))?;

    super::status::build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn apply_git_stash(
    payload: GitStashApplyRequest,
) -> Result<GitRepositoryStatusPayload, String> {
    let mut repository = open_repository_from_root(&payload.repository_root_path)?;
    super::branches::assert_repository_is_clean_for_switch(
        &repository,
        if payload.pop {
            "应用并移除贮藏"
        } else {
            "应用贮藏"
        },
    )?;

    if payload.pop {
        repository
            .stash_pop(payload.stash_index, None)
            .map_err(|error| format!("应用并移除 Git 贮藏失败：{error}"))?;
    } else {
        repository
            .stash_apply(payload.stash_index, None)
            .map_err(|error| format!("应用 Git 贮藏失败：{error}"))?;
    }

    super::status::build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn drop_git_stash(payload: GitStashDropRequest) -> Result<GitRepositoryStatusPayload, String> {
    let mut repository = open_repository_from_root(&payload.repository_root_path)?;
    repository
        .stash_drop(payload.stash_index)
        .map_err(|error| format!("删除 Git 贮藏失败：{error}"))?;
    super::status::build_git_repository_status_payload(&repository)
}

fn parse_git_stash_name(name: &str) -> (Option<String>, Option<String>) {
    let trimmed = name.trim();

    if let Some(rest) = trimmed.strip_prefix("WIP on ") {
        if let Some((branch_name, remainder)) = rest.split_once(':') {
            let remainder = remainder.trim();
            let commit_short_id = remainder
                .split_whitespace()
                .next()
                .filter(|value| is_short_git_commit_id(value))
                .map(str::to_string);

            return (Some(branch_name.trim().to_string()), commit_short_id);
        }
    }

    if let Some(rest) = trimmed.strip_prefix("On ") {
        if let Some((branch_name, _)) = rest.split_once(':') {
            return (Some(branch_name.trim().to_string()), None);
        }
    }

    (None, None)
}

fn is_short_git_commit_id(value: &str) -> bool {
    (7..=40).contains(&value.len()) && value.chars().all(|character| character.is_ascii_hexdigit())
}
