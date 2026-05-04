use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GitDiffMode {
    Worktree,
    Staged,
}

impl GitDiffMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Worktree => GIT_DIFF_MODE_WORKTREE,
            Self::Staged => GIT_DIFF_MODE_STAGED,
        }
    }
}

#[tauri::command]
pub fn get_git_diff_preview(
    payload: GitDiffPreviewRequest,
) -> Result<GitDiffPreviewPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let mode = parse_git_diff_mode(&payload.mode)?;
    let relative_path = resolve_single_relative_path(&repository_root, &payload.path)?;
    let relative_path_text = path_to_forward_slashes(&relative_path);
    let diff_text = build_git_diff_text(&repository, &repository_root, &relative_path, mode)?;
    let content_pair =
        build_git_diff_content_pair(&repository, &repository_root, &relative_path, mode)?;
    let is_empty = diff_text.trim().is_empty();
    let mode_text = mode.as_str().to_string();
    let mode_label = match mode {
        GitDiffMode::Staged => "已暂存",
        GitDiffMode::Worktree => "工作区",
    };

    Ok(GitDiffPreviewPayload {
        id: format!(
            "git-diff:{}:{}:{}",
            mode_text,
            repository_root.to_string_lossy(),
            relative_path_text
        ),
        repository_root_path: repository_root.to_string_lossy().to_string(),
        path: repository_root
            .join(&relative_path)
            .to_string_lossy()
            .to_string(),
        relative_path: relative_path_text.clone(),
        title: format!("{relative_path_text} · {mode_label} Diff"),
        mode: mode_text,
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

pub(super) fn remove_untracked_worktree_path(
    repository_root: &Path,
    relative_path: &Path,
) -> Result<(), String> {
    let target_path = repository_root.join(relative_path);
    if !target_path.exists() {
        return Ok(());
    }

    let canonical_root = normalize_path_for_git(
        &repository_root
            .canonicalize()
            .map_err(|error| format!("读取 Git 工作区根目录失败：{error}"))?,
    );
    let canonical_target = normalize_path_for_git(
        &target_path
            .canonicalize()
            .map_err(|error| format!("读取未跟踪文件路径失败：{error}"))?,
    );

    if !canonical_target.starts_with(&canonical_root) {
        return Err("拒绝删除 Git 工作区之外的未跟踪路径。".into());
    }

    let metadata = fs::symlink_metadata(&target_path)
        .map_err(|error| format!("读取未跟踪路径元数据失败：{error}"))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&target_path).map_err(|error| format!("删除未跟踪目录失败：{error}"))?;
        return Ok(());
    }

    fs::remove_file(&target_path).map_err(|error| format!("删除未跟踪文件失败：{error}"))
}

fn resolve_git_executable() -> Result<PathBuf, String> {
    let executable_name = if cfg!(windows) { "git.exe" } else { "git" };
    find_command_path(
        executable_name,
        &[
            r"C:\Program Files\Git\cmd\git.exe",
            r"C:\Program Files (x86)\Git\cmd\git.exe",
        ],
    )
    .ok_or_else(|| "未找到 git 可执行文件，无法读取 Git Diff。".to_string())
}

fn run_git_diff_command(repository_root: &Path, args: &[String]) -> Result<String, String> {
    let git_executable = resolve_git_executable()?;
    let mut command = Command::new(git_executable);
    configure_std_command_for_background(&mut command);
    command
        .current_dir(repository_root)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|error| format!("执行 Git diff 失败：{error}"))?;

    if !output.status.success() {
        let stderr = decode_process_output(&output.stderr);
        return Err(if stderr.is_empty() {
            "执行 Git diff 失败。".to_string()
        } else {
            format!("执行 Git diff 失败：{stderr}")
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_git_bytes_command(repository_root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let git_executable = resolve_git_executable()?;
    let mut command = Command::new(git_executable);
    configure_std_command_for_background(&mut command);
    command
        .current_dir(repository_root)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|error| format!("执行 Git 命令失败：{error}"))?;

    if !output.status.success() {
        let stderr = decode_process_output(&output.stderr);
        return Err(if stderr.is_empty() {
            "执行 Git 命令失败。".to_string()
        } else {
            format!("执行 Git 命令失败：{stderr}")
        });
    }

    Ok(output.stdout)
}

fn read_git_revision_text(repository_root: &Path, spec: &str) -> Result<Option<String>, String> {
    match run_git_bytes_command(repository_root, &["show", spec]) {
        Ok(bytes) => decode_script_bytes(&bytes)
            .map(|(content, _)| Some(content))
            .map_err(|_| format!("Git 对象不是可直接比较的文本内容：{spec}")),
        Err(_) => Ok(None),
    }
}

fn read_worktree_text(
    repository_root: &Path,
    relative_path: &Path,
) -> Result<Option<String>, String> {
    let file_path = repository_root.join(relative_path);
    if !file_path.exists() {
        return Ok(None);
    }
    if file_path.is_dir() {
        return Err("当前路径是目录，暂不支持直接预览目录 Diff。".to_string());
    }

    let bytes = fs::read(&file_path).map_err(|error| format!("读取工作区文件失败：{error}"))?;
    decode_script_bytes(&bytes)
        .map(|(content, _)| Some(content))
        .map_err(|_| "当前工作区文件不是可直接比较的文本内容。".to_string())
}

pub(super) fn build_git_diff_content_pair(
    repository: &Repository,
    repository_root: &Path,
    relative_path: &Path,
    mode: GitDiffMode,
) -> Result<GitDiffContentPair, String> {
    let relative_path_text = path_to_forward_slashes(relative_path);

    match mode {
        GitDiffMode::Worktree => {
            let original_content = if is_untracked_worktree_path(repository, relative_path)? {
                String::new()
            } else {
                read_git_revision_text(repository_root, &format!(":{relative_path_text}"))?
                    .unwrap_or_default()
            };
            let modified_content =
                read_worktree_text(repository_root, relative_path)?.unwrap_or_default();

            Ok(GitDiffContentPair {
                original_content,
                modified_content,
            })
        }
        GitDiffMode::Staged => {
            let original_content =
                read_git_revision_text(repository_root, &format!("HEAD:{relative_path_text}"))?
                    .unwrap_or_default();
            let modified_content =
                read_git_revision_text(repository_root, &format!(":{relative_path_text}"))?
                    .unwrap_or_default();

            Ok(GitDiffContentPair {
                original_content,
                modified_content,
            })
        }
    }
}

fn build_git_diff_text(
    repository: &Repository,
    repository_root: &Path,
    relative_path: &Path,
    mode: GitDiffMode,
) -> Result<String, String> {
    if mode == GitDiffMode::Worktree && is_untracked_worktree_path(repository, relative_path)? {
        return build_untracked_file_diff(repository_root, relative_path);
    }

    let relative_path_text = path_to_forward_slashes(relative_path);
    let mut args = vec![
        "-c".to_string(),
        "core.quotepath=false".to_string(),
        "diff".to_string(),
        "--no-ext-diff".to_string(),
        "--no-color".to_string(),
        "--ignore-cr-at-eol".to_string(),
        "--find-renames".to_string(),
    ];

    if mode == GitDiffMode::Staged {
        args.push("--cached".to_string());
    }

    args.push("--".to_string());
    args.push(relative_path_text);
    run_git_diff_command(repository_root, &args)
}

fn is_untracked_worktree_path(
    repository: &Repository,
    relative_path: &Path,
) -> Result<bool, String> {
    match repository.status_file(relative_path) {
        Ok(status) => Ok(status.contains(Status::WT_NEW)),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(false),
        Err(error) => Err(format!("读取 Git 文件状态失败：{error}")),
    }
}

pub(super) fn build_untracked_file_diff(
    repository_root: &Path,
    relative_path: &Path,
) -> Result<String, String> {
    let file_path = repository_root.join(relative_path);
    if file_path.is_dir() {
        return Err("当前未跟踪路径是目录，暂不支持直接预览目录 Diff。".to_string());
    }

    let bytes = fs::read(&file_path).map_err(|error| format!("读取未跟踪文件失败：{error}"))?;
    let (content, _) = decode_script_bytes(&bytes)
        .map_err(|_| "当前未跟踪文件不是可直接比较的文本内容。".to_string())?;
    let relative_path_text = path_to_forward_slashes(relative_path);
    let mut lines: Vec<&str> = if content.is_empty() {
        Vec::new()
    } else {
        content.split('\n').collect()
    };
    let has_trailing_newline = content.ends_with('\n');

    if has_trailing_newline {
        lines.pop();
    }

    let mut diff = format!(
        "diff --git a/{0} b/{0}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n",
        relative_path_text,
        lines.len(),
    );

    for line in &lines {
        diff.push('+');
        diff.push_str(line.strip_suffix('\r').unwrap_or(*line));
        diff.push('\n');
    }

    if !has_trailing_newline && !content.is_empty() {
        diff.push_str("\\ No newline at end of file\n");
    }

    Ok(diff)
}

fn decode_process_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}
