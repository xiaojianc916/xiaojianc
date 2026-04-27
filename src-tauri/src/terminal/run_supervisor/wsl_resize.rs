use std::{
    path::PathBuf,
    process::{Command as StdCommand, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

use crate::{commands::configure_std_command_for_background, terminal::wsl::bash_quote};

use super::now_ms;

const WSL_RESIZE_CONTROL_SCRIPT: &str = r#"
tty_path="$(cat "$1" 2>/dev/null || true)"
case "$tty_path" in
  /dev/pts/[0-9]*|/dev/tty[0-9]*)
    stty rows "$2" cols "$3" < "$tty_path" >/dev/null 2>&1 || exit 0
    ;;
esac
"#;

static RUN_RESIZE_CONTROL_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub(super) struct WslResizeControl {
    pub(super) wsl_command_path: PathBuf,
    pub(super) control_path: String,
}

pub(super) fn build_run_command_args_with_resize_control(
    working_directory: &str,
    execution_path: &str,
    resize_control_path: &str,
) -> Vec<String> {
    vec![
        "--cd".to_string(),
        working_directory.to_string(),
        "--".to_string(),
        "/usr/bin/setsid".to_string(),
        "--wait".to_string(),
        "/bin/bash".to_string(),
        "--noprofile".to_string(),
        "--norc".to_string(),
        "-lc".to_string(),
        build_wsl_run_wrapper_script(resize_control_path, execution_path),
    ]
}

fn build_wsl_run_wrapper_script(resize_control_path: &str, execution_path: &str) -> String {
    format!(
        r#"
tty_path="$(tty 2>/dev/null || true)"
case "$tty_path" in
  /dev/pts/[0-9]*|/dev/tty[0-9]*)
    printf '%s\n' "$tty_path" > {} 2>/dev/null || true
    ;;
esac
exec /usr/bin/env LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=xterm-256color /bin/bash --noprofile --norc {}
"#,
        bash_quote(resize_control_path),
        bash_quote(execution_path),
    )
}

pub(super) fn build_resize_control_path() -> String {
    let sequence = RUN_RESIZE_CONTROL_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("/tmp/calamex-rpty-resize-{}-{sequence}.ctl", now_ms())
}

pub(super) fn sync_wsl_tty_size(control: &WslResizeControl, cols: u16, rows: u16) {
    let mut command = StdCommand::new(&control.wsl_command_path);
    configure_std_command_for_background(&mut command);
    let _ = command
        .args([
            "--",
            "/bin/sh",
            "-lc",
            WSL_RESIZE_CONTROL_SCRIPT,
            "calamex-rpty-resize",
            &control.control_path,
            &rows.max(1).to_string(),
            &cols.max(2).to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

pub(super) fn cleanup_resize_control_file(control: &WslResizeControl) {
    let mut command = StdCommand::new(&control.wsl_command_path);
    configure_std_command_for_background(&mut command);
    let _ = command
        .args([
            "--",
            "/bin/sh",
            "-lc",
            "rm -f -- \"$1\"",
            "calamex-rpty-cleanup",
            &control.control_path,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
