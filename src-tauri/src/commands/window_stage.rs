use serde::{Deserialize, Serialize};
use specta::Type;
use std::time::Instant;
use tauri::{AppHandle, LogicalSize, Manager, Size, WebviewWindow};

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_MIN_WIDTH: f64 = 1220.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 760.0;

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum WindowStage {
    Main,
}

fn window_stage_elapsed_ms(started_at: Instant) -> f64 {
    started_at.elapsed().as_secs_f64() * 1000.0
}

fn emit_window_stage_start(stage: &str) {
    eprintln!(
        "{}",
        serde_json::json!({
            "level": "info",
            "scope": "startup",
            "event": "tauri.window-stage.start",
            "stage": stage,
        })
    );
}

fn emit_window_stage_done(stage: &str, started_at: Instant) {
    eprintln!(
        "{}",
        serde_json::json!({
            "level": "info",
            "scope": "startup",
            "event": "tauri.window-stage.done",
            "stage": stage,
            "durationMs": window_stage_elapsed_ms(started_at),
        })
    );
}

fn emit_window_stage_error(stage: &str, started_at: Instant, error: &str) {
    eprintln!(
        "{}",
        serde_json::json!({
            "level": "error",
            "scope": "startup",
            "event": "tauri.window-stage.failed",
            "stage": stage,
            "durationMs": window_stage_elapsed_ms(started_at),
            "error": error,
        })
    );
}

fn resolve_window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("window not found: {label}"))
}

fn show_main_window(window: &WebviewWindow) -> Result<(), String> {
    let main_min_size = Size::Logical(LogicalSize::new(
        MAIN_WINDOW_MIN_WIDTH,
        MAIN_WINDOW_MIN_HEIGHT,
    ));

    let _ = window.unminimize();
    window
        .set_shadow(true)
        .map_err(|error| format!("failed to enable main window shadow: {error}"))?;
    window
        .set_resizable(true)
        .map_err(|error| format!("failed to restore main window resizable state: {error}"))?;
    window
        .set_min_size(Some(main_min_size))
        .map_err(|error| format!("failed to set main window min size: {error}"))?;
    window
        .show()
        .map_err(|error| format!("failed to show main window: {error}"))?;
    let _ = window.set_focus();

    Ok(())
}

impl WindowStage {
    fn as_wire_value(&self) -> &'static str {
        match self {
            Self::Main => "main",
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn apply_window_stage(app: AppHandle, stage: WindowStage) -> Result<(), String> {
    let started_at = Instant::now();
    let stage_name = stage.as_wire_value();
    emit_window_stage_start(stage_name);

    let result = match stage {
        WindowStage::Main => {
            resolve_window(&app, MAIN_WINDOW_LABEL).and_then(|window| show_main_window(&window))
        }
    };

    match &result {
        Ok(()) => emit_window_stage_done(stage_name, started_at),
        Err(error) => emit_window_stage_error(stage_name, started_at, error),
    }

    result
}
