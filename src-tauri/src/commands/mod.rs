use chrono::Utc;
use encoding_rs::{GB18030, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    env,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{process::Command, time::timeout};

const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const EXEC_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptFilePayload {
    path: String,
    name: String,
    content: String,
    encoding: String,
    line_count: usize,
    char_count: usize,
}

#[derive(Debug, Deserialize)]
pub struct SaveScriptRequest {
    path: String,
    content: String,
    encoding: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunScriptRequest {
    path: Option<String>,
    content: String,
    encoding: String,
    executor: String,
    is_dirty: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunScriptResponse {
    success: bool,
    stdout: String,
    stderr: String,
    combined_output: String,
    exit_code: Option<i32>,
    executor: String,
    executor_label: String,
    duration_ms: u128,
    started_at: String,
    finished_at: String,
    command_line: String,
    log_path: Option<String>,
    used_temp_file: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionOption {
    r#type: String,
    label: String,
    available: bool,
    description: String,
    command_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionEnvironment {
    recommended: String,
    has_any: bool,
    executors: Vec<ExecutionOption>,
}

#[derive(Debug, Deserialize)]
pub struct ChmodScriptRequest {
    path: String,
    executor: String,
}

#[derive(Debug, Serialize)]
pub struct OperationResult {
    success: bool,
    message: String,
}

struct ExecutorCandidate {
    kind: &'static str,
    label: &'static str,
    description: &'static str,
    path: Option<PathBuf>,
    available: bool,
}

struct PreparedScript {
    execution_path: PathBuf,
    working_directory: PathBuf,
    used_temp_file: bool,
    cleanup_path: Option<PathBuf>,
}

#[tauri::command]
pub fn load_script(path: String) -> Result<ScriptFilePayload, String> {
    let file_path = PathBuf::from(&path);
    let bytes = fs::read(&file_path).map_err(|error| format!("读取脚本失败：{error}"))?;
    let (content, encoding) = decode_script_bytes(&bytes)?;
    Ok(build_script_payload(file_path, content, encoding))
}

#[tauri::command]
pub fn save_script(payload: SaveScriptRequest) -> Result<ScriptFilePayload, String> {
    let file_path = PathBuf::from(&payload.path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
    }

    let bytes = encode_script_content(&payload.content, &payload.encoding)?;
    fs::write(&file_path, bytes).map_err(|error| format!("保存脚本失败：{error}"))?;
    Ok(build_script_payload(
        file_path,
        payload.content,
        payload.encoding,
    ))
}

#[tauri::command]
pub async fn detect_execution_environment() -> Result<ExecutionEnvironment, String> {
    let executors = collect_executor_candidates().await;
    Ok(build_execution_environment(&executors))
}

#[tauri::command]
pub async fn run_script(payload: RunScriptRequest) -> Result<RunScriptResponse, String> {
    let executors = collect_executor_candidates().await;
    let executor = resolve_executor(&payload.executor, &executors)?;
    let prepared = prepare_script(&payload)?;
    let started_at = Utc::now();
    let start_time = Instant::now();
    let (mut command, command_line) = build_run_command(executor, &prepared)?;
    let output = execute_command(&mut command, EXEC_TIMEOUT).await?;
    let duration_ms = start_time.elapsed().as_millis();
    let finished_at = Utc::now();

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined_output = merge_output(&stdout, &stderr);
    let success = output.status.success();
    let log_path = write_run_log(
        &started_at.to_rfc3339(),
        &finished_at.to_rfc3339(),
        &command_line,
        &stdout,
        &stderr,
        output.status.code(),
    )?;

    if let Some(path) = prepared.cleanup_path {
        let _ = fs::remove_file(path);
    }

    Ok(RunScriptResponse {
        success,
        stdout,
        stderr,
        combined_output,
        exit_code: output.status.code(),
        executor: executor.kind.to_string(),
        executor_label: executor.label.to_string(),
        duration_ms,
        started_at: started_at.to_rfc3339(),
        finished_at: finished_at.to_rfc3339(),
        command_line,
        log_path: Some(log_path.to_string_lossy().to_string()),
        used_temp_file: prepared.used_temp_file,
    })
}

#[tauri::command]
pub async fn chmod_script(payload: ChmodScriptRequest) -> Result<OperationResult, String> {
    let target_path = PathBuf::from(&payload.path);
    if !target_path.exists() {
        return Err("脚本文件不存在，请先保存到本地后再执行 chmod +x。".into());
    }

    let executors = collect_executor_candidates().await;
    let executor = resolve_executor(&payload.executor, &executors)?;
    let mut command = build_chmod_command(executor, &target_path)?;
    let output = execute_command(&mut command, PROBE_TIMEOUT).await?;

    if output.status.success() {
        Ok(OperationResult {
            success: true,
            message: format!("已通过 {} 为脚本执行 chmod +x。", executor.label),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.trim().is_empty() {
            format!("{} 执行 chmod +x 失败。", executor.label)
        } else {
            format!("{} 执行 chmod +x 失败：{}", executor.label, stderr.trim())
        })
    }
}

fn build_script_payload(path: PathBuf, content: String, encoding: String) -> ScriptFilePayload {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled.sh")
        .to_string();

    ScriptFilePayload {
        path: path.to_string_lossy().to_string(),
        name,
        line_count: line_count(&content),
        char_count: content.chars().count(),
        content,
        encoding,
    }
}

fn line_count(content: &str) -> usize {
    if content.is_empty() {
        1
    } else {
        content.split('\n').count()
    }
}

fn decode_script_bytes(bytes: &[u8]) -> Result<(String, String), String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let content = String::from_utf8(bytes[3..].to_vec()).map_err(|error| error.to_string())?;
        return Ok((content, "utf-8-bom".into()));
    }

    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_with_encoding(&bytes[2..], UTF_16LE, "utf-16le");
    }

    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_with_encoding(&bytes[2..], UTF_16BE, "utf-16be");
    }

    let (utf8, _, utf8_errors) = UTF_8.decode(bytes);
    if !utf8_errors {
        return Ok((utf8.into_owned(), "utf-8".into()));
    }

    let (gb18030, _, gb_errors) = GB18030.decode(bytes);
    if !gb_errors {
        return Ok((gb18030.into_owned(), "gb18030".into()));
    }

    Err("无法识别文件编码，请确认脚本是否为常见 UTF-8 / GB 编码。".into())
}

fn decode_with_encoding(
    bytes: &[u8],
    encoding: &'static encoding_rs::Encoding,
    encoding_name: &str,
) -> Result<(String, String), String> {
    let (content, _, had_errors) = encoding.decode(bytes);
    if had_errors {
        return Err(format!("使用 {encoding_name} 解码脚本失败。"));
    }

    Ok((content.into_owned(), encoding_name.to_string()))
}

fn encode_script_content(content: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "utf-8" => Ok(content.as_bytes().to_vec()),
        "utf-8-bom" => {
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(content.as_bytes());
            Ok(bytes)
        }
        "utf-16le" => encode_with_encoding(content, UTF_16LE, "utf-16le", true),
        "utf-16be" => encode_with_encoding(content, UTF_16BE, "utf-16be", true),
        "gbk" => encode_with_encoding_name(content, "gbk"),
        "gb18030" => encode_with_encoding_name(content, "gb18030"),
        _ => Err(format!("暂不支持编码：{encoding}")),
    }
}

fn encode_with_encoding(
    content: &str,
    encoding: &'static encoding_rs::Encoding,
    label: &str,
    with_bom: bool,
) -> Result<Vec<u8>, String> {
    let (bytes, _, had_errors) = encoding.encode(content);
    if had_errors {
        return Err(format!("将内容编码为 {label} 失败。"));
    }

    let mut result = Vec::new();
    if with_bom {
        if label == "utf-16le" {
            result.extend_from_slice(&[0xFF, 0xFE]);
        } else if label == "utf-16be" {
            result.extend_from_slice(&[0xFE, 0xFF]);
        }
    }
    result.extend_from_slice(bytes.as_ref());
    Ok(result)
}

fn encode_with_encoding_name(content: &str, label: &str) -> Result<Vec<u8>, String> {
    let (bytes, _, had_errors): (Cow<[u8]>, _, bool) = match label {
        "gbk" => encoding_rs::GBK.encode(content),
        "gb18030" => GB18030.encode(content),
        _ => return Err(format!("暂不支持编码：{label}")),
    };
    if had_errors {
        return Err(format!("将内容编码为 {label} 失败。"));
    }
    Ok(bytes.into_owned())
}

async fn collect_executor_candidates() -> Vec<ExecutorCandidate> {
    let mut executors = vec![
        ExecutorCandidate {
            kind: "wsl",
            label: "WSL",
            description: "优先使用真实 Linux 子系统执行脚本，兼容性最高。",
            path: find_command_path("wsl.exe", &["C:\\Windows\\System32\\wsl.exe"]),
            available: false,
        },
        ExecutorCandidate {
            kind: "git-bash",
            label: "Git Bash / sh",
            description: "适合日常调试与本地 shell 片段验证。",
            path: find_command_path(
                "sh.exe",
                &[
                    "C:\\Program Files\\Git\\bin\\sh.exe",
                    "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
                ],
            ),
            available: false,
        },
        ExecutorCandidate {
            kind: "bash",
            label: "Windows Bash",
            description: "兼容旧版 bash.exe / WSL Legacy 环境。",
            path: find_command_path("bash.exe", &["C:\\Windows\\System32\\bash.exe"]),
            available: false,
        },
    ];

    for item in executors.iter_mut() {
        item.available = probe_executor(item).await;
    }

    executors
}

fn build_execution_environment(executors: &[ExecutorCandidate]) -> ExecutionEnvironment {
    let has_any = executors.iter().any(|item| item.available);
    let recommended = executors
        .iter()
        .find(|item| item.available)
        .map(|item| item.kind.to_string())
        .unwrap_or_else(|| "auto".to_string());

    ExecutionEnvironment {
        recommended,
        has_any,
        executors: executors
            .iter()
            .map(|item| ExecutionOption {
                r#type: item.kind.to_string(),
                label: item.label.to_string(),
                available: item.available,
                description: item.description.to_string(),
                command_path: item.path.as_ref().map(|value| value.to_string_lossy().to_string()),
            })
            .collect(),
    }
}

fn find_command_path(file_name: &str, extra_candidates: &[&str]) -> Option<PathBuf> {
    if let Some(path_var) = env::var_os("PATH") {
        for directory in env::split_paths(&path_var) {
            let candidate = directory.join(file_name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    extra_candidates
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.exists())
}

async fn probe_executor(candidate: &ExecutorCandidate) -> bool {
    let Some(path) = candidate.path.as_ref() else {
        return false;
    };

    let mut command = Command::new(path);
    match candidate.kind {
        "wsl" => {
            command.args(["--", "bash", "-lc", "printf ready"]);
        }
        _ => {
            command.args(["-lc", "printf ready"]);
        }
    }
    command.stdout(Stdio::null()).stderr(Stdio::null());

    matches!(
        timeout(PROBE_TIMEOUT, command.status()).await,
        Ok(Ok(status)) if status.success()
    )
}

fn resolve_executor<'a>(
    requested: &str,
    executors: &'a [ExecutorCandidate],
) -> Result<&'a ExecutorCandidate, String> {
    if requested != "auto" {
        return executors
            .iter()
            .find(|item| item.kind == requested && item.available)
            .ok_or_else(|| format!("当前系统不可用执行器：{requested}"));
    }

    executors
        .iter()
        .find(|item| item.available)
        .ok_or_else(|| "当前系统未检测到可执行的 bash/sh 环境。".into())
}

fn prepare_script(payload: &RunScriptRequest) -> Result<PreparedScript, String> {
    let preferred_path = payload.path.as_ref().map(PathBuf::from);
    let working_directory = preferred_path
        .as_ref()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(env::temp_dir);

    let should_use_temp = payload.is_dirty
        || preferred_path
            .as_ref()
            .map(|path| !path.exists())
            .unwrap_or(true);

    if should_use_temp {
        let file_name = preferred_path
            .as_ref()
            .and_then(|path| path.file_name().and_then(|value| value.to_str()))
            .unwrap_or("untitled.sh");
        let temp_path = create_temp_script(
            &working_directory,
            file_name,
            &payload.content,
            &payload.encoding,
        )?;
        return Ok(PreparedScript {
            execution_path: temp_path.clone(),
            working_directory,
            used_temp_file: true,
            cleanup_path: Some(temp_path),
        });
    }

    let execution_path = preferred_path.ok_or_else(|| "脚本路径无效。".to_string())?;
    Ok(PreparedScript {
        execution_path,
        working_directory,
        used_temp_file: false,
        cleanup_path: None,
    })
}

fn create_temp_script(
    preferred_directory: &Path,
    original_name: &str,
    content: &str,
    encoding: &str,
) -> Result<PathBuf, String> {
    let directory = if preferred_directory.exists() {
        preferred_directory.to_path_buf()
    } else {
        env::temp_dir()
    };
    fs::create_dir_all(&directory).map_err(|error| format!("创建临时目录失败：{error}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let stem = Path::new(original_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled");
    let temp_path = directory.join(format!("{stem}-{stamp}.tmp.sh"));
    let bytes = encode_script_content(content, encoding)?;
    fs::write(&temp_path, bytes).map_err(|error| format!("写入临时脚本失败：{error}"))?;
    Ok(temp_path)
}

fn build_run_command(
    executor: &ExecutorCandidate,
    prepared: &PreparedScript,
) -> Result<(Command, String), String> {
    match executor.kind {
        "git-bash" => {
            let mut command = Command::new(
                executor
                    .path
                    .as_ref()
                    .ok_or_else(|| "未找到 Git Bash / sh 可执行文件。".to_string())?,
            );
            let file_name = prepared
                .execution_path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "脚本文件名无效。".to_string())?;
            command.current_dir(&prepared.working_directory);
            command.args(["-lc", "sh \"$1\"", "_", &format!("./{file_name}")]);
            command.stdout(Stdio::piped()).stderr(Stdio::piped());
            Ok((
                command,
                format!(
                    "{} -lc \"sh \\\"$1\\\"\" _ ./{}",
                    executor
                        .path
                        .as_ref()
                        .map(|value| value.to_string_lossy())
                        .unwrap_or_default(),
                    file_name
                ),
            ))
        }
        "wsl" | "bash" => {
            let shell_path = executor
                .path
                .as_ref()
                .ok_or_else(|| "未找到 WSL / Bash 可执行文件。".to_string())?;
            let script_path = to_wsl_path(&prepared.execution_path)?;
            let working_directory = to_wsl_path(&prepared.working_directory)?;
            let bash_script = format!(
                "cd {} && bash {}",
                bash_quote(&working_directory),
                bash_quote(&script_path)
            );
            let mut command = Command::new(shell_path);
            if executor.kind == "wsl" {
                command.args(["--", "bash", "-lc", &bash_script]);
            } else {
                command.args(["-lc", &bash_script]);
            }
            command.stdout(Stdio::piped()).stderr(Stdio::piped());
            Ok((
                command,
                format!(
                    "{} {}",
                    shell_path.to_string_lossy(),
                    if executor.kind == "wsl" {
                        format!("-- bash -lc {}", bash_quote(&bash_script))
                    } else {
                        format!("-lc {}", bash_quote(&bash_script))
                    }
                ),
            ))
        }
        _ => Err(format!("不支持的执行器：{}", executor.kind)),
    }
}

fn build_chmod_command(
    executor: &ExecutorCandidate,
    target_path: &Path,
) -> Result<Command, String> {
    match executor.kind {
        "git-bash" => {
            let file_name = target_path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "脚本文件名无效。".to_string())?;
            let mut command = Command::new(
                executor
                    .path
                    .as_ref()
                    .ok_or_else(|| "未找到 Git Bash / sh 可执行文件。".to_string())?,
            );
            command.current_dir(
                target_path
                    .parent()
                    .ok_or_else(|| "脚本目录不存在。".to_string())?,
            );
            command.args(["-lc", "chmod +x \"$1\"", "_", &format!("./{file_name}")]);
            command.stdout(Stdio::piped()).stderr(Stdio::piped());
            Ok(command)
        }
        "wsl" | "bash" => {
            let shell_path = executor
                .path
                .as_ref()
                .ok_or_else(|| "未找到 WSL / Bash 可执行文件。".to_string())?;
            let script_path = to_wsl_path(target_path)?;
            let bash_script = format!("chmod +x {}", bash_quote(&script_path));
            let mut command = Command::new(shell_path);
            if executor.kind == "wsl" {
                command.args(["--", "bash", "-lc", &bash_script]);
            } else {
                command.args(["-lc", &bash_script]);
            }
            command.stdout(Stdio::piped()).stderr(Stdio::piped());
            Ok(command)
        }
        _ => Err(format!("不支持的执行器：{}", executor.kind)),
    }
}

fn to_wsl_path(path: &Path) -> Result<String, String> {
    let normalized = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/");

    let drive_letter = normalized
        .chars()
        .next()
        .ok_or_else(|| "无法识别 Windows 路径。".to_string())?;
    if !normalized.contains(':') {
        return Err("仅支持 Windows 本地磁盘路径转换为 WSL 路径。".into());
    }

    let rest = normalized
        .get(2..)
        .ok_or_else(|| "Windows 路径格式无效。".to_string())?;
    Ok(format!("/mnt/{}/{}", drive_letter.to_ascii_lowercase(), rest.trim_start_matches('/')))
}

fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

async fn execute_command(
    command: &mut Command,
    timeout_duration: Duration,
) -> Result<std::process::Output, String> {
    match timeout(timeout_duration, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(format!("执行脚本失败：{error}")),
        Err(_) => Err(format!(
            "脚本执行超时（超过 {} 秒），请检查脚本是否阻塞。",
            timeout_duration.as_secs()
        )),
    }
}

fn merge_output(stdout: &str, stderr: &str) -> String {
    match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (false, false) => format!("# stdout\n{stdout}\n\n# stderr\n{stderr}"),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (true, true) => "# 脚本已执行，但未产生任何标准输出。".into(),
    }
}

fn write_run_log(
    started_at: &str,
    finished_at: &str,
    command_line: &str,
    stdout: &str,
    stderr: &str,
    exit_code: Option<i32>,
) -> Result<PathBuf, String> {
    let file_name = format!("sh-editor-run-{}.log", Utc::now().format("%Y%m%d_%H%M%S"));
    let log_path = env::temp_dir().join(file_name);
    let log_content = format!(
        "started_at={started_at}\nfinished_at={finished_at}\nexit_code={}\ncommand={command_line}\n\n[stdout]\n{stdout}\n\n[stderr]\n{stderr}\n",
        exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".into())
    );
    fs::write(&log_path, log_content).map_err(|error| format!("写入运行日志失败：{error}"))?;
    Ok(log_path)
}
