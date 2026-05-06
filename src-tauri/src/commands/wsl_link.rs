use crate::wsl_link::{
    agent_distribution::{
        agent_binary_artifact_report, build_agent_distribution_bundle,
        install_agent_distribution_bundle, resolve_agent_binary_bytes_with_extra_candidates,
        start_installed_agent, WslLinkAgentDistributionPlan, WslLinkDistroTarget,
        PACKAGED_AGENT_RESOURCE_PATH,
    },
    grpc_transport::{open_primary_grpc_session, WslLinkOpenSessionHandshake},
    noise_material::KeyringWslLinkNoiseMaterialStore,
    runtime::{WslLinkRuntimeState, WslLinkStatusPayload},
    self_check::{
        check_wsl_link_environment as run_wsl_link_environment_check, WslLinkEnvironmentReport,
    },
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, time::Instant};
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallWslLinkAgentRequest {
    pub confirm_install: bool,
    pub distro_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartWslLinkAgentRequest {
    pub confirm_start: bool,
    pub distro_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallWslLinkAgentPayload {
    pub binary_path: String,
    pub noise_config_path: String,
    pub step_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartWslLinkAgentPayload {
    pub binary_path: String,
    pub noise_config_path: String,
    pub pid_path: String,
    pub log_path: String,
    pub stdout: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkAgentArtifactPayload {
    pub found: bool,
    pub path: Option<String>,
    pub candidates: Vec<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeWslLinkPrimaryPayload {
    pub ok: bool,
    pub message: String,
    pub session_id: Option<String>,
    pub transport: Option<crate::wsl_link::types::WslLinkTransportKind>,
    pub server_seq: Option<u64>,
    pub ack_client_seq: Option<u64>,
    pub rtt_ms: Option<u64>,
}

#[tauri::command]
pub fn get_wsl_link_status(
    state: tauri::State<'_, WslLinkRuntimeState>,
) -> Result<WslLinkStatusPayload, String> {
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn check_wsl_link_environment() -> Result<WslLinkEnvironmentReport, String> {
    Ok(run_wsl_link_environment_check().await)
}

#[tauri::command]
pub fn get_wsl_link_agent_artifact_status(
    app: AppHandle,
) -> Result<WslLinkAgentArtifactPayload, String> {
    let report = agent_binary_artifact_report(app_agent_binary_candidates(&app))
        .map_err(|error| format!("读取 WSL Link agent 构建产物状态失败：{error}"))?;

    Ok(WslLinkAgentArtifactPayload {
        found: report.found,
        path: report.path.map(path_to_string),
        candidates: report.candidates.into_iter().map(path_to_string).collect(),
        message: report.message,
    })
}

#[tauri::command]
pub async fn install_wsl_link_agent(
    app: AppHandle,
    payload: InstallWslLinkAgentRequest,
) -> Result<InstallWslLinkAgentPayload, String> {
    if !payload.confirm_install {
        return Err("安装 WSL Link agent 需要显式确认 confirmInstall=true。".to_string());
    }

    let plan = build_user_agent_plan(payload.distro_name)?;
    let agent_binary =
        resolve_agent_binary_bytes_with_extra_candidates(app_agent_binary_candidates(&app))
            .map_err(|error| error.to_string())?;
    let bundle =
        build_agent_distribution_bundle(plan, agent_binary).map_err(|error| error.to_string())?;
    let outcome = install_agent_distribution_bundle(&bundle, &KeyringWslLinkNoiseMaterialStore)
        .await
        .map_err(|error| error.to_string())?;

    Ok(InstallWslLinkAgentPayload {
        binary_path: outcome.binary_path,
        noise_config_path: outcome.noise_config_path,
        step_count: outcome.outputs.len(),
    })
}

#[tauri::command]
pub async fn start_wsl_link_agent(
    payload: StartWslLinkAgentRequest,
) -> Result<StartWslLinkAgentPayload, String> {
    if !payload.confirm_start {
        return Err("启动 WSL Link agent 需要显式确认 confirmStart=true。".to_string());
    }

    let plan = build_user_agent_plan(payload.distro_name)?;
    let outcome = start_installed_agent(&plan)
        .await
        .map_err(|error| error.to_string())?;

    Ok(StartWslLinkAgentPayload {
        binary_path: outcome.binary_path,
        noise_config_path: outcome.noise_config_path,
        pid_path: outcome.pid_path,
        log_path: outcome.log_path,
        stdout: outcome.stdout,
    })
}

#[tauri::command]
pub async fn probe_wsl_link_primary(
    state: tauri::State<'_, WslLinkRuntimeState>,
) -> Result<ProbeWslLinkPrimaryPayload, String> {
    let config = state.begin_connect_attempt()?;
    let handshake = WslLinkOpenSessionHandshake::new(
        "calamex-desktop",
        format!("wsl-link-probe-{}", crate::wsl_link::types::now_unix_ms()),
        0,
    )
    .map_err(|error| error.to_string())?;
    let started_at = Instant::now();

    match open_primary_grpc_session(config, handshake).await {
        Ok(session) => {
            let rtt_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            state.record_connect_success(session.transport)?;
            Ok(ProbeWslLinkPrimaryPayload {
                ok: true,
                message: "WSL Link 主通道 OpenSession 握手成功。".to_string(),
                session_id: Some(session.session_id),
                transport: Some(session.transport),
                server_seq: Some(session.server_seq),
                ack_client_seq: Some(session.ack_client_seq),
                rtt_ms: Some(rtt_ms),
            })
        }
        Err(error) => {
            let message = error.to_string();
            state.record_connect_failure(message.clone())?;
            Ok(ProbeWslLinkPrimaryPayload {
                ok: false,
                message,
                session_id: None,
                transport: None,
                server_seq: None,
                ack_client_seq: None,
                rtt_ms: None,
            })
        }
    }
}

fn build_user_agent_plan(
    distro_name: Option<String>,
) -> Result<WslLinkAgentDistributionPlan, String> {
    let distro = match distro_name {
        Some(value) => WslLinkDistroTarget::named(value).map_err(|error| error.to_string())?,
        None => WslLinkDistroTarget::Default,
    };

    WslLinkAgentDistributionPlan::for_user_paths(
        distro,
        crate::wsl_link::agent_distribution::USER_AGENT_INSTALL_DIR,
        crate::wsl_link::agent_distribution::USER_AGENT_CONFIG_DIR,
    )
    .map_err(|error| error.to_string())
}

fn app_agent_binary_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = app
        .path()
        .resolve(PACKAGED_AGENT_RESOURCE_PATH, BaseDirectory::Resource)
    {
        candidates.push(path);
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(PACKAGED_AGENT_RESOURCE_PATH));
        candidates.push(resource_dir.join("wsl-link/wsl-link-agent-x86_64-unknown-linux-gnu"));
    }

    candidates
}

fn path_to_string(path: PathBuf) -> String {
    path.display().to_string()
}
