mod commands;

use commands::{
    chmod_script, detect_execution_environment, load_script, run_script, save_script,
};
use tauri::{LogicalPosition, LogicalSize, Manager, Position, Size};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_size(Size::Logical(LogicalSize::new(1500.0, 960.0)));
                let _ = window.set_position(Position::Logical(LogicalPosition::new(120.0, 80.0)));
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_script,
            save_script,
            detect_execution_environment,
            run_script,
            chmod_script
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SH editor");
}
