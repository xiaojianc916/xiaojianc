use super::*;
use super::cli;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GitDiffMode { Worktree, Staged }

impl GitDiffMode {
    fn as_str(self) -> &'static str {
        match self { Self::Worktree => GIT_DIFF_MODE_WORKTREE, Self::Staged => GIT_DIFF_MODE_STAGED }
    }
}

#[tauri::command]
pub fn get_git_diff_preview(payload: GitDiffPreviewRequest) -> Result<GitDiffPreviewPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let mode = parse_git_diff_mode(&payload.mode)?;
    let relative_path = resolve_single_relative_path(&repository_root, &payload.path)?;
    let relative_path_text = path_to_forward_slashes(&relative_path);
    let diff_text = build_git_diff_text(&repository_root, &relative_path, mode)?;
    let content_pair = build_git_diff_content_pair(&repository_root, &relative_path, mode)?;
    let is_empty = diff_text.trim().is_empty();
    let mode_label = match mode { GitDiffMode::Staged => "已暂存", GitDiffMode::Worktree => "工作区" };

    Ok(GitDiffPreviewPayload {
        id: format!("git-diff:{}:{}:{}", mode.as_str(), repository_root.to_string_lossy(), relative_path_text),
        repository_root_path: repository_root.to_string_lossy().to_string(),
        path: repository_root.join(&relative_path).to_string_lossy().to_string(),
        relative_path: relative_path_text.clone(),
        title: format!("{relative_path_text} · {mode_label} Diff"),
        mode: mode.as_str().to_string(),
        original_content: content_pair.original_content,
        modified_content: content_pair.modified_content,
        is_empty,
    })
}

pub(super) fn parse_git_diff_mode(value: &str) -> Result<GitDiffMode, String> {
    match value {
        GIT_DIFF_MODE_WORKTREE => Ok(GitDiffMode::Worktree),
        GIT_DIFF_MODE_STAGED => Ok(GitDiffMode::Staged),
        _ => Err(format!("不支持的 Git Diff 模式：{value}")),
    }
}

pub(super) fn remove_untracked_worktree_path(repository_root: &Path, relative_path: &Path) -> Result<(), String> {
    let target_path = repository_root.join(relative_path);
    if !target_path.exists() { return Ok(()); }
    let canonical_root = normalize_path_for_git(&repository_root.canonicalize().map_err(|e| format!("读取 Git 工作区根目录失败：{e}"))?);
    let canonical_target = normalize_path_for_git(&target_path.canonicalize().map_err(|e| format!("读取未跟踪文件路径失败：{e}"))?);
    if !canonical_target.starts_with(&canonical_root) { return Err("拒绝删除 Git 工作区之外的未跟踪路径。".into()); }
    let metadata = fs::symlink_metadata(&target_path).map_err(|e| format!("读取未跟踪路径元数据失败：{e}"))?;
    if metadata.is_dir() { fs::remove_dir_all(&target_path).map_err(|e| format!("删除未跟踪目录失败：{e}"))?; }
    else { fs::remove_file(&target_path).map_err(|e| format!("删除未跟踪文件失败：{e}"))?; }
    Ok(())
}

fn resolve_single_relative_path(repository_root: &Path, path: &str) -> Result<PathBuf, String> {
    resolve_relative_path(repository_root, Path::new(path))
}

fn read_worktree_text(repository_root: &Path, relative_path: &Path) -> Result<Option<String>, String> {
    let file_path = repository_root.join(relative_path);
    if !file_path.exists() { return Ok(None); }
    if file_path.is_dir() { return Err("当前路径是目录，暂不支持直接预览目录 Diff。".to_string()); }
    let bytes = fs::read(&file_path).map_err(|e| format!("读取工作区文件失败：{e}"))?;
    decode_script_bytes(&bytes).map(|(c, _)| Some(c)).map_err(|_| "当前工作区文件不是可直接比较的文本内容。".to_string())
}

pub(super) fn build_git_diff_content_pair(
    repository_root: &Path,
    relative_path: &Path,
    mode: GitDiffMode,
) -> Result<GitDiffContentPair, String> {
    let relative_path_text = path_to_forward_slashes(relative_path);
    match mode {
        GitDiffMode::Worktree => {
            let original = if is_untracked_git_path(repository_root, relative_path)? {
                String::new()
            } else {
                super::status::read_git_revision_text(repository_root, &format!(":{relative_path_text}"))?.unwrap_or_default()
            };
            let modified = read_worktree_text(repository_root, relative_path)?.unwrap_or_default();
            Ok(GitDiffContentPair { original_content: original, modified_content: modified })
        }
        GitDiffMode::Staged => {
            let original = super::status::read_git_revision_text(repository_root, &format!("HEAD:{relative_path_text}"))?.unwrap_or_default();
            let modified = super::status::read_git_revision_text(repository_root, &format!(":{relative_path_text}"))?.unwrap_or_default();
            Ok(GitDiffContentPair { original_content: original, modified_content: modified })
        }
    }
}

fn build_git_diff_text(repository_root: &Path, relative_path: &Path, mode: GitDiffMode) -> Result<String, String> {
    if mode == GitDiffMode::Worktree && is_untracked_git_path(repository_root, relative_path)? {
        return build_untracked_file_diff(repository_root, relative_path);
    }
    let rp = path_to_forward_slashes(relative_path);
    let cached = if mode == GitDiffMode::Staged { vec!["--cached"] } else { vec![] };
    let mut args = vec!["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-color", "--ignore-cr-at-eol", "--find-renames"];
    args.extend(cached.iter().map(|s| *s));
    args.extend(&["--", &rp]);
    let str_args: Vec<&str> = args.iter().map(|s| *s).collect();
    cli::run_git_text(repository_root, &str_args, "读取 diff")
}

fn is_untracked_git_path(repository_root: &Path, relative_path: &Path) -> Result<bool, String> {
    let rp = path_to_forward_slashes(relative_path);
    match cli::run_git_text_allow_exit_one(repository_root, &["ls-files", "--error-unmatch", &rp], "检查跟踪") {
        Ok(Some(_)) => Ok(false),
        _ => Ok(true),
    }
}

#[allow(dead_code)]
pub(super) fn build_untracked_file_diff(repository_root: &Path, relative_path: &Path) -> Result<String, String> {
    let file_path = repository_root.join(relative_path);
    if file_path.is_dir() { return Err("当前未跟踪路径是目录，暂不支持直接预览目录 Diff。".to_string()); }
    let bytes = fs::read(&file_path).map_err(|e| format!("读取未跟踪文件失败：{e}"))?;
    let (content, _) = decode_script_bytes(&bytes).map_err(|_| "当前未跟踪文件不是可直接比较的文本内容。".to_string())?;
    let rp = path_to_forward_slashes(relative_path);
    let mut lines: Vec<&str> = if content.is_empty() { Vec::new() } else { content.split('\n').collect() };
    let has_trailing = content.ends_with('\n');
    if has_trailing { lines.pop(); }
    let mut diff = format!("diff --git a/{0} b/{0}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n", rp, lines.len());
    for line in &lines { diff.push('+'); diff.push_str(line.strip_suffix('\r').unwrap_or(*line)); diff.push('\n'); }
    if !has_trailing && !content.is_empty() { diff.push_str("\\ No newline at end of file\n"); }
    Ok(diff)
}
