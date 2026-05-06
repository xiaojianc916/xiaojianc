use crate::wsl_link::runtime::{WslLinkRuntimeState, WslLinkStatusPayload};

#[tauri::command]
pub fn get_wsl_link_status(
    state: tauri::State<'_, WslLinkRuntimeState>,
) -> Result<WslLinkStatusPayload, String> {
    Ok(state.snapshot())
}
