use super::{configure_std_command_for_background, find_command_path};
use chrono::Utc;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering as AtomicOrdering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const WSL_TEMP_DIRECTORY: &str = "/tmp";
const TERMINAL_READ_BUFFER_SIZE: usize = 64 * 1024;
const TERMINAL_EVENT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const TERMINAL_EVENT_FLUSH_THRESHOLD: usize = 64 * 1024;
const TERMINAL_SNAPSHOT_MAX_LENGTH: usize = 160 * 1024;

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static WSL_COMMAND_PATH_CACHE: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureTerminalSessionRequest {
    session_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionPayload {
    session_id: String,
    cwd: String,
    shell_label: String,
    created: bool,
    initial_output: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchTerminalScriptRequest {
    session_id: String,
    path: Option<String>,
    content: String,
    is_dirty: bool,
    run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchTerminalScriptPayload {
    session_id: String,
    cwd: String,
    command_line: String,
    used_temp_file: bool,
    started_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputRequest {
    session_id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTerminalSessionRequest {
    session_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalDataEvent {
    session_id: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalRunOutputEvent {
    session_id: String,
    run_id: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalRunCompleteEvent {
    session_id: String,
    run_id: String,
    exit_code: Option<i32>,
    finished_at: String,
}

struct TerminalPreparedScript {
    execution_path: String,
    working_directory: String,
    used_temp_file: bool,
    should_cleanup_execution_path: bool,
    should_materialize_inline_content: bool,
}

struct TerminalDispatchCommand {
    display_command: String,
    used_temp_file: bool,
    execution_path: String,
    working_directory: String,
    cleanup_paths: Vec<String>,
}

struct TerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    working_directory: String,
}

#[derive(Default)]
struct TerminalUtf8ChunkDecoder {
    pending: Vec<u8>,
}

enum TerminalEmitterMessage {
    VisibleOutput(String),
    Close,
}

#[derive(Clone, Default)]
pub struct TerminalSessionState {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
    snapshots: Arc<Mutex<HashMap<String, String>>>,
    creation_guard: Arc<Mutex<()>>,
}

#[tauri::command]
pub fn ensure_terminal_session(
    app: AppHandle,
    state: State<TerminalSessionState>,
    payload: EnsureTerminalSessionRequest,
) -> Result<TerminalSessionPayload, String> {
    let terminal_state = state.inner().clone();
    let (child, reader, terminal_cwd) = {
        let _creation_guard = terminal_state
            .creation_guard
            .lock()
            .map_err(|_| "终端会话创建锁已损坏。".to_string())?;

        if let Some(existing_session) = get_terminal_session(&terminal_state, &payload.session_id)?
        {
            if payload.cwd.is_none() && should_recreate_terminal_session(existing_session.as_ref())
            {
                remove_terminal_session(&terminal_state, &payload.session_id)?;
                remove_terminal_snapshot(&terminal_state, &payload.session_id)?;
                terminate_terminal_session(existing_session.as_ref())?;
            } else {
                resize_session_master(existing_session.as_ref(), payload.cols, payload.rows)?;
                let initial_output = get_terminal_snapshot(&terminal_state, &payload.session_id)?;

                return Ok(TerminalSessionPayload {
                    session_id: payload.session_id,
                    cwd: existing_session.working_directory.clone(),
                    shell_label: "WSL2".into(),
                    created: false,
                    initial_output: (!initial_output.is_empty()).then_some(initial_output),
                });
            }
        }

        let wsl_command_path = resolve_wsl_command_path()?;
        let working_directory = resolve_terminal_start_directory(payload.cwd.as_deref())?;
        let terminal_cwd = working_directory
            .as_ref()
            .map(|path| to_wsl_path(path.as_path()))
            .transpose()?
            .or_else(|| resolve_wsl_home_directory(&wsl_command_path))
            .unwrap_or_else(|| "~".to_string());
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(normalize_pty_size(payload.cols, payload.rows))
            .map_err(|error| format!("创建终端会话失败：{error}"))?;

        let mut command = CommandBuilder::new(wsl_command_path.to_string_lossy().as_ref());
        command.arg("--cd");
        command.arg(&terminal_cwd);
        command.arg("--");
        command.arg("/bin/bash");
        command.arg("-il");
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let child = pty_pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("启动 WSL2 终端失败：{error}"))?;
        let killer = child.clone_killer();
        drop(pty_pair.slave);

        let reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("初始化终端读通道失败：{error}"))?;
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|error| format!("初始化终端写通道失败：{error}"))?;

        let session = Arc::new(TerminalSession {
            master: Mutex::new(pty_pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            working_directory: terminal_cwd.clone(),
        });

        {
            let mut sessions = lock_terminal_sessions(&terminal_state)?;
            sessions.insert(payload.session_id.clone(), Arc::clone(&session));
        }

        set_terminal_snapshot(&terminal_state, &payload.session_id, String::new())?;

        (child, reader, terminal_cwd)
    };

    spawn_terminal_reader(
        app.clone(),
        terminal_state.clone(),
        payload.session_id.clone(),
        reader,
    );
    spawn_terminal_waiter(app, terminal_state, payload.session_id.clone(), child);

    Ok(TerminalSessionPayload {
        session_id: payload.session_id,
        cwd: terminal_cwd,
        shell_label: "WSL2".into(),
        created: true,
        initial_output: None,
    })
}

#[tauri::command]
pub fn write_terminal_input(
    state: State<TerminalSessionState>,
    payload: TerminalInputRequest,
) -> Result<(), String> {
    let terminal_state = state.inner().clone();
    let session = get_terminal_session(&terminal_state, &payload.session_id)?
        .ok_or_else(|| "目标终端会话不存在。".to_string())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "终端写入通道已损坏。".to_string())?;

    writer
        .write_all(payload.data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("写入终端输入失败：{error}"))
}

#[tauri::command]
pub fn resize_terminal_session(
    state: State<TerminalSessionState>,
    payload: TerminalResizeRequest,
) -> Result<(), String> {
    let terminal_state = state.inner().clone();
    let session = get_terminal_session(&terminal_state, &payload.session_id)?
        .ok_or_else(|| "目标终端会话不存在。".to_string())?;

    resize_session_master(session.as_ref(), payload.cols, payload.rows)
}

#[tauri::command]
pub fn close_terminal_session(
    state: State<TerminalSessionState>,
    payload: CloseTerminalSessionRequest,
) -> Result<(), String> {
    let terminal_state = state.inner().clone();
    let removed_session = remove_terminal_session(&terminal_state, &payload.session_id)?;
    remove_terminal_snapshot(&terminal_state, &payload.session_id)?;

    let Some(session) = removed_session else {
        return Ok(());
    };

    terminate_terminal_session(session.as_ref())
}

pub fn shutdown_all_terminal_sessions(state: &TerminalSessionState) -> Result<(), String> {
    let sessions = {
        let mut sessions_map = lock_terminal_sessions(state)?;
        sessions_map
            .drain()
            .map(|(_, session)| session)
            .collect::<Vec<_>>()
    };

    for session in sessions {
        terminate_terminal_session(session.as_ref())?;
    }

    Ok(())
}

#[tauri::command]
pub fn dispatch_script_to_terminal(
    app: AppHandle,
    state: State<TerminalSessionState>,
    payload: DispatchTerminalScriptRequest,
) -> Result<DispatchTerminalScriptPayload, String> {
    let terminal_state = state.inner().clone();
    let session = get_terminal_session(&terminal_state, &payload.session_id)?
        .ok_or_else(|| "目标终端会话不存在，请先打开集成终端。".to_string())?;
    let started_at = Utc::now();
    let command = build_terminal_run_command(&payload, &session.working_directory)?;
    let command_line = command.display_command.clone();
    let used_temp_file = command.used_temp_file;

    spawn_terminal_child_run(
        app,
        terminal_state,
        payload.session_id.clone(),
        payload.run_id.clone(),
        command,
    );

    Ok(DispatchTerminalScriptPayload {
        session_id: payload.session_id,
        cwd: session.working_directory.clone(),
        command_line,
        used_temp_file,
        started_at: started_at.to_rfc3339(),
    })
}

fn lock_terminal_sessions(
    state: &TerminalSessionState,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, Arc<TerminalSession>>>, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "终端会话状态已损坏。".to_string())
}

fn get_terminal_session(
    state: &TerminalSessionState,
    session_id: &str,
) -> Result<Option<Arc<TerminalSession>>, String> {
    let sessions = lock_terminal_sessions(state)?;
    Ok(sessions.get(session_id).cloned())
}

fn remove_terminal_session(
    state: &TerminalSessionState,
    session_id: &str,
) -> Result<Option<Arc<TerminalSession>>, String> {
    let mut sessions = lock_terminal_sessions(state)?;
    Ok(sessions.remove(session_id))
}

fn lock_terminal_snapshots(
    state: &TerminalSessionState,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, String>>, String> {
    state
        .snapshots
        .lock()
        .map_err(|_| "终端快照状态已损坏。".to_string())
}

fn get_terminal_snapshot(state: &TerminalSessionState, session_id: &str) -> Result<String, String> {
    let snapshots = lock_terminal_snapshots(state)?;
    Ok(snapshots.get(session_id).cloned().unwrap_or_default())
}

fn set_terminal_snapshot(
    state: &TerminalSessionState,
    session_id: &str,
    value: String,
) -> Result<(), String> {
    let mut snapshots = lock_terminal_snapshots(state)?;
    snapshots.insert(session_id.to_string(), value);
    Ok(())
}

fn remove_terminal_snapshot(state: &TerminalSessionState, session_id: &str) -> Result<(), String> {
    let mut snapshots = lock_terminal_snapshots(state)?;
    snapshots.remove(session_id);
    Ok(())
}

fn advance_char_boundary(value: &str, index: usize) -> usize {
    if index >= value.len() {
        return value.len();
    }

    let mut next_index = index;
    while next_index < value.len() && !value.is_char_boundary(next_index) {
        next_index += 1;
    }
    next_index
}

fn trim_terminal_snapshot(snapshot: &mut String) {
    if snapshot.len() <= TERMINAL_SNAPSHOT_MAX_LENGTH {
        return;
    }

    let overflow = snapshot.len() - TERMINAL_SNAPSHOT_MAX_LENGTH;
    let trim_index = snapshot[overflow..]
        .find('\n')
        .map(|index| overflow + index + 1)
        .unwrap_or(overflow);
    let safe_trim_index = advance_char_boundary(snapshot, trim_index);
    snapshot.drain(..safe_trim_index);
}

fn append_terminal_snapshot(
    state: &TerminalSessionState,
    session_id: &str,
    chunk: &str,
) -> Result<(), String> {
    if chunk.is_empty() {
        return Ok(());
    }

    let mut snapshots = lock_terminal_snapshots(state)?;
    let snapshot = snapshots.entry(session_id.to_string()).or_default();
    snapshot.push_str(chunk);
    trim_terminal_snapshot(snapshot);
    Ok(())
}

fn normalize_pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn resize_session_master(session: &TerminalSession, cols: u16, rows: u16) -> Result<(), String> {
    let master = session
        .master
        .lock()
        .map_err(|_| "终端尺寸通道已损坏。".to_string())?;

    master
        .resize(normalize_pty_size(cols, rows))
        .map_err(|error| format!("同步终端尺寸失败：{error}"))
}

fn should_recreate_terminal_session(session: &TerminalSession) -> bool {
    let cwd = session.working_directory.trim();
    cwd.is_empty()
        || cwd.contains('\\')
        || cwd.contains(':')
        || (!cwd.starts_with('/') && cwd != "~")
}

fn terminate_terminal_session(session: &TerminalSession) -> Result<(), String> {
    let mut killer = session
        .killer
        .lock()
        .map_err(|_| "终端结束通道已损坏。".to_string())?;
    match killer.kill() {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = error.to_string();
            if message.contains("os error 0") {
                Ok(())
            } else {
                Err(format!("关闭 WSL2 终端失败：{error}"))
            }
        }
    }
}

fn resolve_terminal_start_directory(path: Option<&str>) -> Result<Option<PathBuf>, String> {
    if let Some(path) = path {
        let directory = PathBuf::from(path)
            .canonicalize()
            .map_err(|error| format!("读取终端工作目录失败：{error}"))?;

        if !directory.is_dir() {
            return Err("终端工作目录不是有效目录。".into());
        }

        return Ok(Some(directory));
    }

    Ok(None)
}

fn resolve_wsl_home_directory(wsl_command_path: &Path) -> Option<String> {
    let mut command = StdCommand::new(wsl_command_path);
    configure_std_command_for_background(&mut command);
    let output = command.args(["--cd", "~", "--", "pwd"]).output().ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn resolve_wsl_command_path() -> Result<PathBuf, String> {
    {
        let cached_path = WSL_COMMAND_PATH_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(path) = cached_path.as_ref().filter(|path| path.exists()) {
            return Ok(path.clone());
        }
    }

    let resolved_path = find_command_path("wsl.exe", &["C:\\Windows\\System32\\wsl.exe"])
        .ok_or_else(|| "当前系统未发现可用的 wsl.exe，请先安装或启用 WSL2。".to_string())?;
    let mut cached_path = WSL_COMMAND_PATH_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cached_path = Some(resolved_path.clone());
    Ok(resolved_path)
}

fn write_wsl_file(path: &str, content: &[u8]) -> Result<(), String> {
    let wsl_command_path = resolve_wsl_command_path()?;
    let shell_command = format!(
        "umask 077 && cat > {} && chmod 600 {}",
        bash_quote(path),
        bash_quote(path),
    );
    let mut command = StdCommand::new(wsl_command_path);
    configure_std_command_for_background(&mut command);
    command
        .args(["--", "sh", "-lc", &shell_command])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("写入 WSL 临时文件失败：{error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "WSL 写入通道不可用。".to_string())?;
    stdin
        .write_all(content)
        .map_err(|error| format!("写入 WSL 临时文件失败：{error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|error| format!("等待 WSL 临时文件写入完成失败：{error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("写入 WSL 临时文件失败。".into())
    } else {
        Err(format!("写入 WSL 临时文件失败：{stderr}"))
    }
}

pub(crate) fn build_temp_file_suffix() -> Result<String, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_micros();
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, AtomicOrdering::Relaxed);

    Ok(format!("{stamp}-{sequence}"))
}

fn build_terminal_temp_script_path(original_name: &str) -> Result<String, String> {
    let suffix = build_temp_file_suffix()?;
    let stem = Path::new(original_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("untitled");

    Ok(format!("{WSL_TEMP_DIRECTORY}/{stem}-{suffix}.tmp.sh"))
}

fn emit_terminal_data(app: &AppHandle, payload: TerminalDataEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("terminal:data", payload);
    }
}

fn emit_terminal_run_output(app: &AppHandle, payload: TerminalRunOutputEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("terminal:run-output", payload);
    }
}

fn emit_terminal_exit(app: &AppHandle, payload: TerminalExitEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("terminal:exit", payload);
    }
}

fn emit_terminal_run_complete(app: &AppHandle, payload: TerminalRunCompleteEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("terminal:run-complete", payload);
    }
}

fn emit_terminal_run_output_chunk(
    app: &AppHandle,
    state: &TerminalSessionState,
    session_id: &str,
    run_id: &str,
    data: String,
) {
    if data.is_empty() {
        return;
    }

    let _ = append_terminal_snapshot(state, session_id, &data);
    emit_terminal_run_output(
        app,
        TerminalRunOutputEvent {
            session_id: session_id.to_string(),
            run_id: run_id.to_string(),
            data,
        },
    );
}

fn flush_terminal_data_buffer(
    app: &AppHandle,
    state: &TerminalSessionState,
    session_id: &str,
    buffer: &mut String,
) {
    if buffer.is_empty() {
        return;
    }

    let chunk = std::mem::take(buffer);
    let _ = append_terminal_snapshot(state, session_id, &chunk);

    emit_terminal_data(
        app,
        TerminalDataEvent {
            session_id: session_id.to_string(),
            data: chunk,
        },
    );
}

fn spawn_terminal_event_emitter(
    app: AppHandle,
    state: TerminalSessionState,
    session_id: String,
    receiver: mpsc::Receiver<TerminalEmitterMessage>,
) {
    thread::spawn(move || {
        let mut visible_output_buffer = String::new();

        loop {
            match receiver.recv_timeout(TERMINAL_EVENT_FLUSH_INTERVAL) {
                Ok(TerminalEmitterMessage::VisibleOutput(chunk)) => {
                    visible_output_buffer.push_str(&chunk);
                    if visible_output_buffer.len() >= TERMINAL_EVENT_FLUSH_THRESHOLD {
                        flush_terminal_data_buffer(
                            &app,
                            &state,
                            &session_id,
                            &mut visible_output_buffer,
                        );
                    }
                }
                Ok(TerminalEmitterMessage::Close) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    flush_terminal_data_buffer(
                        &app,
                        &state,
                        &session_id,
                        &mut visible_output_buffer,
                    );
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        flush_terminal_data_buffer(&app, &state, &session_id, &mut visible_output_buffer);
    });
}

fn spawn_terminal_reader(
    app: AppHandle,
    state: TerminalSessionState,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
) {
    let (sender, receiver) = mpsc::channel::<TerminalEmitterMessage>();
    spawn_terminal_event_emitter(app, state, session_id, receiver);

    thread::spawn(move || {
        let mut buffer = [0_u8; TERMINAL_READ_BUFFER_SIZE];
        let mut decoded_chunk = String::new();
        let mut decoder = TerminalUtf8ChunkDecoder::default();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    decoded_chunk.clear();
                    decoder.decode_into(&buffer[..size], &mut decoded_chunk, false);
                    if decoded_chunk.is_empty() {
                        continue;
                    }

                    let _ = sender.send(TerminalEmitterMessage::VisibleOutput(decoded_chunk.clone()));
                }
                Err(_) => break,
            }
        }

        decoded_chunk.clear();
        decoder.decode_into(&[], &mut decoded_chunk, true);
        if !decoded_chunk.is_empty() {
            let _ = sender.send(TerminalEmitterMessage::VisibleOutput(decoded_chunk));
        }

        let _ = sender.send(TerminalEmitterMessage::Close);
    });
}

fn spawn_terminal_waiter(
    app: AppHandle,
    state: TerminalSessionState,
    session_id: String,
    mut child: Box<dyn Child + Send + Sync>,
) {
    thread::spawn(move || {
        let exit_code = child
            .wait()
            .ok()
            .and_then(|status| i32::try_from(status.exit_code()).ok());

        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.remove(&session_id);
        }
        if let Ok(mut snapshots) = state.snapshots.lock() {
            snapshots.remove(&session_id);
        }

        emit_terminal_exit(
            &app,
            TerminalExitEvent {
                session_id,
                exit_code,
            },
        );
    });
}

fn spawn_terminal_child_output_reader<R>(
    app: AppHandle,
    state: TerminalSessionState,
    session_id: String,
    run_id: String,
    mut reader: R,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; TERMINAL_READ_BUFFER_SIZE];
        let mut decoded_chunk = String::new();
        let mut decoder = TerminalUtf8ChunkDecoder::default();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    decoded_chunk.clear();
                    decoder.decode_into(&buffer[..size], &mut decoded_chunk, false);
                    if decoded_chunk.is_empty() {
                        continue;
                    }

                    emit_terminal_run_output_chunk(
                        &app,
                        &state,
                        &session_id,
                        &run_id,
                        decoded_chunk.clone(),
                    );
                }
                Err(_) => break,
            }
        }

        decoded_chunk.clear();
        decoder.decode_into(&[], &mut decoded_chunk, true);
        if !decoded_chunk.is_empty() {
            emit_terminal_run_output_chunk(&app, &state, &session_id, &run_id, decoded_chunk);
        }
    })
}

fn cleanup_terminal_child_run_files(paths: &[String]) {
    if paths.is_empty() {
        return;
    }

    let Ok(wsl_command_path) = resolve_wsl_command_path() else {
        return;
    };
    let cleanup_command = format!(
        "rm -f {}",
        paths
            .iter()
            .map(|path| bash_quote(path))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let mut command = StdCommand::new(wsl_command_path);
    configure_std_command_for_background(&mut command);
    let _ = command
        .args(["--", "sh", "-lc", &cleanup_command])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn spawn_terminal_child_run(
    app: AppHandle,
    state: TerminalSessionState,
    session_id: String,
    run_id: String,
    command: TerminalDispatchCommand,
) {
    thread::spawn(move || {
        let wsl_command_path = match resolve_wsl_command_path() {
            Ok(path) => path,
            Err(error) => {
                emit_terminal_run_output_chunk(
                    &app,
                    &state,
                    &session_id,
                    &run_id,
                    format!("启动 WSL2 失败：{error}\n"),
                );
                emit_terminal_run_complete(
                    &app,
                    TerminalRunCompleteEvent {
                        session_id,
                        run_id,
                        exit_code: Some(127),
                        finished_at: Utc::now().to_rfc3339(),
                    },
                );
                return;
            }
        };

        let mut child_command = StdCommand::new(wsl_command_path);
        configure_std_command_for_background(&mut child_command);
        child_command
            .args([
                "--cd",
                &command.working_directory,
                "--",
                "/bin/bash",
                &command.execution_path,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match child_command.spawn() {
            Ok(child) => child,
            Err(error) => {
                emit_terminal_run_output_chunk(
                    &app,
                    &state,
                    &session_id,
                    &run_id,
                    format!("启动脚本进程失败：{error}\n"),
                );
                cleanup_terminal_child_run_files(&command.cleanup_paths);
                emit_terminal_run_complete(
                    &app,
                    TerminalRunCompleteEvent {
                        session_id,
                        run_id,
                        exit_code: Some(127),
                        finished_at: Utc::now().to_rfc3339(),
                    },
                );
                return;
            }
        };
        let child_pid = child.id();

        let mut reader_threads = Vec::new();
        if let Some(stdout) = child.stdout.take() {
            reader_threads.push(spawn_terminal_child_output_reader(
                app.clone(),
                state.clone(),
                session_id.clone(),
                run_id.clone(),
                stdout,
            ));
        }
        if let Some(stderr) = child.stderr.take() {
            reader_threads.push(spawn_terminal_child_output_reader(
                app.clone(),
                state.clone(),
                session_id.clone(),
                run_id.clone(),
                stderr,
            ));
        }

        let exit_code = child
            .wait()
            .ok()
            .and_then(|status| status.code())
            .or(Some(1));
        eprintln!(
            "script-child-exited pid={child_pid} session_id={session_id} run_id={run_id} exit_code={:?}",
            exit_code
        );

        for reader_thread in reader_threads {
            let _ = reader_thread.join();
        }

        cleanup_terminal_child_run_files(&command.cleanup_paths);
        emit_terminal_run_complete(
            &app,
            TerminalRunCompleteEvent {
                session_id,
                run_id,
                exit_code,
                finished_at: Utc::now().to_rfc3339(),
            },
        );
    });
}

impl TerminalUtf8ChunkDecoder {
    fn decode_into(&mut self, input: &[u8], output: &mut String, last: bool) {
        if !input.is_empty() {
            self.pending.extend_from_slice(input);
        }

        loop {
            if self.pending.is_empty() {
                return;
            }

            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    output.push_str(valid);
                    self.pending.clear();
                    return;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();

                    if valid_up_to > 0 {
                        if let Ok(valid_prefix) = std::str::from_utf8(&self.pending[..valid_up_to])
                        {
                            output.push_str(valid_prefix);
                        }
                        self.pending.drain(..valid_up_to);
                        continue;
                    }

                    if let Some(error_len) = error.error_len() {
                        output.push('\u{FFFD}');
                        self.pending.drain(..error_len);
                        continue;
                    }

                    if last {
                        output.push('\u{FFFD}');
                        self.pending.clear();
                    }

                    return;
                }
            }
        }
    }
}

fn prepare_terminal_dispatch_script(
    payload: &DispatchTerminalScriptRequest,
    terminal_working_directory: &str,
) -> Result<TerminalPreparedScript, String> {
    let preferred_path = payload.path.as_ref().map(PathBuf::from);
    let working_directory = preferred_path
        .as_ref()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| to_wsl_path(&path))
        .transpose()?
        .unwrap_or_else(|| terminal_working_directory.to_string());

    let has_existing_preferred_path = preferred_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let should_use_temp = payload.is_dirty || !has_existing_preferred_path;

    if should_use_temp {
        if !payload.is_dirty && preferred_path.is_some() && payload.content.is_empty() {
            return Err("脚本文件不存在或不可访问，请保存后再运行。".to_string());
        }

        let file_name = preferred_path
            .as_ref()
            .and_then(|path| path.file_name().and_then(|value| value.to_str()))
            .unwrap_or("untitled.sh");
        let temp_path = build_terminal_temp_script_path(file_name)?;
        return Ok(TerminalPreparedScript {
            execution_path: temp_path,
            working_directory,
            used_temp_file: true,
            should_cleanup_execution_path: true,
            should_materialize_inline_content: true,
        });
    }

    let execution_path = preferred_path.ok_or_else(|| "脚本路径无效。".to_string())?;
    Ok(TerminalPreparedScript {
        execution_path: to_wsl_path(&execution_path)?,
        working_directory,
        used_temp_file: false,
        should_cleanup_execution_path: false,
        should_materialize_inline_content: false,
    })
}

fn build_terminal_run_command(
    payload: &DispatchTerminalScriptRequest,
    terminal_working_directory: &str,
) -> Result<TerminalDispatchCommand, String> {
    let prepared = prepare_terminal_dispatch_script(payload, terminal_working_directory)?;
    if prepared.should_materialize_inline_content {
        write_wsl_file(&prepared.execution_path, payload.content.as_bytes())
            .map_err(|error| format!("写入临时脚本失败：{error}"))?;
    }
    let cleanup_paths = if prepared.should_cleanup_execution_path {
        vec![prepared.execution_path.clone()]
    } else {
        Vec::new()
    };

    Ok(TerminalDispatchCommand {
        display_command: format!("/bin/bash {}", bash_quote(&prepared.execution_path)),
        used_temp_file: prepared.used_temp_file,
        execution_path: prepared.execution_path,
        working_directory: prepared.working_directory,
        cleanup_paths,
    })
}

pub(crate) fn to_wsl_path(path: &Path) -> Result<String, String> {
    let normalized = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    let normalized = normalize_windows_path_for_wsl(&normalized)?;

    let drive_letter = normalized
        .chars()
        .next()
        .ok_or_else(|| "无法识别 Windows 路径。".to_string())?;

    if !drive_letter.is_ascii_alphabetic() || !normalized.contains(':') {
        return Err("仅支持 Windows 本地磁盘路径转换为 WSL 路径。".into());
    }

    let rest = normalized
        .get(2..)
        .ok_or_else(|| "Windows 路径格式无效。".to_string())?;

    Ok(format!(
        "/mnt/{}/{}",
        drive_letter.to_ascii_lowercase(),
        rest.replace('\\', "/").trim_start_matches('/'),
    ))
}

fn normalize_windows_path_for_wsl(value: &str) -> Result<String, String> {
    if let Some(network_path) = value.strip_prefix(r"\\?\UNC\") {
        return Err(format!(
            "暂不支持将网络共享路径转换为 WSL 路径：\\\\{}",
            network_path
        ));
    }

    if let Some(extended_path) = value.strip_prefix(r"\\?\") {
        return Ok(extended_path.to_string());
    }

    Ok(value.to_string())
}

fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
