use super::*;
use super::cli;
use gix::bstr::ByteSlice;

#[tauri::command]
pub fn list_git_stashes(payload: GitRepositoryRootRequest) -> Result<GitStashListPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let output = cli::run_git_text(&repository_root, &["stash", "list", "--format=%gd|%gs|%H"], "读取贮藏列表")?;

    let mut entries = Vec::new();
    for (index, line) in output.lines().enumerate() {
        if line.trim().is_empty() { continue; }
        let parts: Vec<&str> = line.splitn(3, '|').collect();
        if parts.len() < 3 { continue; }
        let _stash_id = parts[0].trim().to_string();
        let summary = parts[1].trim().to_string();
        let oid_str = parts[2].trim().to_string();
        let oid: gix::ObjectId = oid_str.parse().map_err(|_| format!("解析 Git 贮藏 OID 失败：{oid_str}"))?;
        entries.push(build_git_stash_entry_payload(&repository, index, &summary, oid)?);
    }
    Ok(GitStashListPayload { entries })
}

#[tauri::command]
pub fn save_git_stash(payload: GitStashSaveRequest) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let status = super::status::build_git_repository_status_payload(&repository)?;
    if status.is_clean {
        return Err("当前没有可贮藏的改动。".into());
    }
    if status.conflicted_count > 0 {
        return Err("存在冲突文件，解决冲突后再执行贮藏。".into());
    }

    let mut args = vec!["stash", "push"];
    if payload.include_untracked { args.push("--include-untracked"); }
    if let Some(ref message) = payload.message {
        let msg = message.trim();
        if !msg.is_empty() { args.push("--message"); args.push(msg); }
    }
    cli::run_git_ok(&repository_root, &args, "保存贮藏")?;
    super::status::build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn apply_git_stash(payload: GitStashApplyRequest) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let label = if payload.pop { "应用并移除贮藏" } else { "应用贮藏" };
    super::branches::assert_repository_is_clean_for_switch(&repository, label)?;

    let stash_ref = format!("stash@{{{}}}", payload.stash_index);
    let args = if payload.pop { vec!["stash", "pop", &stash_ref] } else { vec!["stash", "apply", &stash_ref] };
    cli::run_git_ok(&repository_root, &args, label)?;

    super::status::build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn drop_git_stash(payload: GitStashDropRequest) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let stash_ref = format!("stash@{{{}}}", payload.stash_index);
    cli::run_git_ok(&repository_root, &["stash", "drop", &stash_ref], "删除贮藏")?;
    super::status::build_git_repository_status_payload(&repository)
}

fn build_git_stash_entry_payload(
    repository: &Repository,
    index: usize,
    summary: &str,
    oid: gix::ObjectId,
) -> Result<GitStashEntryPayload, String> {
    let commit = repository.find_commit(oid).map_err(|error| format!("读取 Git 贮藏提交失败：{error}"))?;
    let details = build_git_stash_details(repository, &commit)?;
    let (branch_name, commit_short_id) = parse_git_stash_name(summary);
    Ok(GitStashEntryPayload {
        index,
        stash_id: format!("stash@{{{index}}}"),
        summary: summary.to_string(),
        branch_name,
        commit_short_id: commit_short_id.or_else(|| Some(short_commit_id(oid))),
        created_at: details.created_at,
        file_count: details.file_count,
        additions: details.additions,
        deletions: details.deletions,
        files: details.files,
    })
}

fn build_git_stash_details(repository: &Repository, commit: &gix::Commit<'_>) -> Result<GitStashDetails, String> {
    let created_at = jiff::Timestamp::from_second(commit.time().unwrap_or_default().seconds as i64)
        .unwrap_or_else(|_| jiff::Timestamp::now()).to_string();
    let stash_tree = commit.tree().map_err(|error| format!("读取 Git 贮藏快照失败：{error}"))?;

    let parent_tree = if commit.parent_ids().count() > 0 {
        let parent_oid = commit.parent_ids().next().expect("parent exists");
        Some(repository.find_commit(parent_oid)
            .map_err(|error| format!("读取 Git 贮藏基线失败：{error}"))?
            .tree().map_err(|error| format!("读取 Git 贮藏基线树失败：{error}"))?)
    } else { None };

    let mut file_count = 0usize;
    let mut additions = 0u32;
    let mut deletions = 0u32;
    let mut files = Vec::new();

    for entry_result in stash_tree.iter() {
        let entry = entry_result.map_err(|error| format!("读取 Git 贮藏树条目失败：{error}"))?;
        let filename = entry.filename();
        let relative_path = filename.to_str_lossy().into_owned();

        let (status, fa, fd) = if let Some(ref pt) = parent_tree {
            let parent_entry = pt.iter().filter_map(|e| e.ok()).find(|e| e.filename() == filename);
            if let Some(pe) = parent_entry {
                if entry.mode() != pe.mode() || entry.id() != pe.id() { ("modified", 1, 1) } else { continue; }
            } else { ("added", 1, 0) }
        } else { ("added", 1, 0) };

        file_count += 1;
        additions += fa;
        deletions += fd;
        files.push(GitStashFilePayload {
            relative_path: relative_path.clone(),
            file_name: Path::new(&relative_path).file_name().and_then(|v| v.to_str()).map(str::to_string).unwrap_or_else(|| relative_path.clone()),
            previous_relative_path: None,
            status: status.to_string(),
            additions: fa,
            deletions: fd,
        });
    }

    if let Some(ref pt) = parent_tree {
        for entry_result in pt.iter() {
            let Ok(entry) = entry_result else { continue };
            let filename = entry.filename();
            if !stash_tree.iter().filter_map(|e| e.ok()).any(|e| e.filename() == filename) {
                let rp = filename.to_str_lossy().into_owned();
                file_count += 1;
                deletions += 1;
                files.push(GitStashFilePayload {
                    file_name: Path::new(&rp).file_name().and_then(|v| v.to_str()).map(str::to_string).unwrap_or_else(|| rp.clone()),
                    relative_path: rp,
                    previous_relative_path: None,
                    status: "deleted".to_string(),
                    additions: 0,
                    deletions: 1,
                });
            }
        }
    }

    Ok(GitStashDetails { created_at, file_count, additions: additions.min(u32::MAX as u32), deletions: deletions.min(u32::MAX as u32), files })
}

struct GitStashDetails { created_at: String, file_count: usize, additions: u32, deletions: u32, files: Vec<GitStashFilePayload> }

fn parse_git_stash_name(name: &str) -> (Option<String>, Option<String>) {
    let trimmed = name.trim();
    if let Some(rest) = trimmed.strip_prefix("WIP on ") {
        if let Some((branch_name, remainder)) = rest.split_once(':') {
            let commit_short_id = remainder.trim().split_whitespace().next()
                .filter(|value| is_short_git_commit_id(value)).map(str::to_string);
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
    (7..=40).contains(&value.len()) && value.chars().all(|c| c.is_ascii_hexdigit())
}