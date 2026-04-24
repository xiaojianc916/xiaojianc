#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod error;

use commands::{
    analyze_script, apply_window_stage, begin_startup_transition, close_terminal_session,
    commit_git_index, detect_execution_environment, dispatch_script_to_terminal,
    ensure_terminal_session, finalize_startup_transition, format_script,
    get_git_file_baseline, get_git_repository_status, get_startup_workspace, init_git_repository,
    list_workspace_entries, load_image_asset, load_script, resize_terminal_session, save_script,
    set_window_background, shutdown_all_terminal_sessions, stage_git_paths,
    unstage_git_paths, write_terminal_input, TerminalSessionState,
};
use std::time::Duration;
use tauri::{Manager, WindowEvent};
use tokio::time::sleep;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(TerminalSessionState::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle();
                if window.label() == "main" {
                    let terminal_state = app_handle.state::<TerminalSessionState>();
                    if let Err(error) = shutdown_all_terminal_sessions(terminal_state.inner()) {
                        eprintln!("failed to shutdown terminal sessions: {error}");
                    }

                    app_handle.exit(0);
                }
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                sleep(Duration::from_millis(1_500)).await;

                let main_visible = app_handle
                    .get_webview_window("main")
                    .and_then(|window| window.is_visible().ok())
                    .unwrap_or(false);

                let Some(welcome_window) = app_handle.get_webview_window("welcome") else {
                    return;
                };

                let welcome_visible = welcome_window.is_visible().unwrap_or(false);
                if welcome_visible || main_visible {
                    return;
                }

                let _ = welcome_window.show();
                let _ = welcome_window.set_focus();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            apply_window_stage,
            set_window_background,
            begin_startup_transition,
            finalize_startup_transition,
            get_startup_workspace,
            load_script,
            load_image_asset,
            save_script,
            analyze_script,
            format_script,
            detect_execution_environment,
            dispatch_script_to_terminal,
            list_workspace_entries,
            get_git_repository_status,
            init_git_repository,
            get_git_file_baseline,
            stage_git_paths,
            unstage_git_paths,
            commit_git_index,
            ensure_terminal_session,
            write_terminal_input,
            resize_terminal_session,
            close_terminal_session
        ]);

    if let Err(error) = app.run(tauri::generate_context!()) {
        eprintln!("failed to run SH editor: {error}");
        std::process::exit(1);
    }
}
