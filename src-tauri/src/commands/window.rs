use crate::error::AppError;
use serde::Deserialize;
use tauri::{window::Color, AppHandle, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWindowBackgroundInput {
    pub label: Option<String>,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

fn resolve_window_label(label: Option<&str>) -> &str {
    label.unwrap_or("main")
}

#[tauri::command]
pub async fn set_window_background(
    app: AppHandle,
    input: SetWindowBackgroundInput,
    trace_id: Option<String>,
) -> Result<(), AppError> {
    let label = resolve_window_label(input.label.as_deref());
    let trace_id = trace_id.as_deref().unwrap_or("unavailable");

    tracing::info!(
        event = "window.set_background",
        label = label,
        r = input.r,
        g = input.g,
        b = input.b,
        a = input.a,
        traceId = trace_id,
    );

    let window = app
        .get_webview_window(label)
        .ok_or_else(|| AppError::not_found(format!("window `{label}` not found")))?;
    window
        .set_background_color(Some(Color(input.r, input.g, input.b, input.a)))
        .map_err(AppError::tauri)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::resolve_window_label;
    use crate::error::AppError;
    use serde_json::json;

    #[test]
    fn resolve_window_label_defaults_to_main_when_missing() {
        assert_eq!(resolve_window_label(None), "main");
    }

    #[test]
    fn resolve_window_label_keeps_explicit_label() {
        assert_eq!(resolve_window_label(Some("preview")), "preview");
    }

    #[test]
    fn app_error_serializes_stable_not_found_code() {
        let payload = match serde_json::to_value(AppError::not_found("missing")) {
            Ok(value) => value,
            Err(error) => panic!("serialize AppError failed: {error}"),
        };
        assert_eq!(
            payload,
            json!({
                "code": "window.not-found",
                "message": "missing",
            }),
        );
    }
}
