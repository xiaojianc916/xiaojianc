use crate::commands::{shell_tools, window, window_stage, workspace_fs};
use std::path::PathBuf;
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder, ErrorHandlingMode};

pub fn builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .error_handling(ErrorHandlingMode::Throw)
        .commands(collect_commands![
            shell_tools::analyze_script,
            shell_tools::format_script,
            window_stage::apply_window_stage,
            window::set_window_background,
            workspace_fs::create_workspace_path,
            workspace_fs::delete_workspace_path,
            workspace_fs::list_workspace_entries,
            workspace_fs::load_image_asset,
            workspace_fs::load_script,
            workspace_fs::rename_workspace_path,
            workspace_fs::save_script,
        ])
}

pub fn export(builder: &Builder<tauri::Wry>) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/bindings/tauri.ts");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("failed to create tauri binding directory");
    }

    builder
        .export(Typescript::default(), path)
        .expect("failed to export tauri-specta TypeScript bindings");
}
