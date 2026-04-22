mod contracts;
mod git;
mod script_run;
mod shell_tools;
mod terminal;
mod window;
mod window_stage;
mod workspace_fs;

pub use contracts::{
    AnalyzeScriptPayload, AnalyzeScriptRequest, ExecutionEnvironment, ExecutionOption,
    FormatScriptPayload, FormatScriptRequest, ImageAssetPayload, SaveScriptRequest,
    ScriptDiagnosticPayload, ScriptFilePayload, StartupWorkspacePayload, WorkspaceDirectoryPayload,
    WorkspaceEntry,
};
pub use git::{
    commit_git_index, get_git_file_baseline, get_git_repository_status, init_git_repository,
    stage_git_paths, unstage_git_paths,
};
pub use script_run::detect_execution_environment;
pub(crate) use script_run::{create_temp_script, find_command_path, line_count};
pub use shell_tools::{analyze_script, format_script};
pub(crate) use terminal::{build_temp_file_suffix, to_wsl_path};
pub use terminal::{
    close_terminal_session, dispatch_script_to_terminal, ensure_terminal_session,
    resize_terminal_session, write_terminal_input, TerminalSessionState,
};
pub use window::set_window_background;
pub use window_stage::{apply_window_stage, show_startup_window};
pub(crate) use workspace_fs::{
    decode_script_bytes, encode_script_content, resolve_workspace_root, workspace_name,
};
pub use workspace_fs::{
    get_startup_workspace, list_workspace_entries, load_image_asset, load_script, save_script,
};
