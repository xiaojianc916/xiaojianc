use std::{
    fs,
    path::{Path, PathBuf},
};

use thiserror::Error;

use super::{
    agent_runtime::DEFAULT_AGENT_NOISE_CONFIG_PATH,
    noise_material::{
        encode_agent_material, load_agent_material_from_file, WslLinkAgentNoiseMaterial,
        WslLinkNoiseMaterialError,
    },
    types::now_unix_ms,
};

pub const DEFAULT_AGENT_CONFIG_DIR: &str = "/etc/calamex/wsl-link";
pub const AGENT_NOISE_CONFIG_FILE_NAME: &str = "agent-noise.json";

#[derive(Debug, Error)]
pub enum WslLinkAgentInstallError {
    #[error("WSL Link agent 安装路径不是目录：{0}")]
    TargetIsNotDirectory(PathBuf),
    #[error("WSL Link agent 配置安装 IO 失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("WSL Link agent Noise 配置编码失败：{0}")]
    NoiseMaterial(#[from] WslLinkNoiseMaterialError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslLinkAgentInstallPlan {
    pub config_dir: PathBuf,
    pub noise_config_path: PathBuf,
}

impl WslLinkAgentInstallPlan {
    pub fn default_linux() -> Self {
        let config_dir = PathBuf::from(DEFAULT_AGENT_CONFIG_DIR);
        Self {
            noise_config_path: PathBuf::from(DEFAULT_AGENT_NOISE_CONFIG_PATH),
            config_dir,
        }
    }

    pub fn for_config_dir(config_dir: PathBuf) -> Self {
        Self {
            noise_config_path: config_dir.join(AGENT_NOISE_CONFIG_FILE_NAME),
            config_dir,
        }
    }
}

pub fn install_agent_noise_material(
    config_dir: &Path,
    material: &WslLinkAgentNoiseMaterial,
) -> Result<PathBuf, WslLinkAgentInstallError> {
    prepare_config_dir(config_dir)?;
    let target_path = config_dir.join(AGENT_NOISE_CONFIG_FILE_NAME);
    let temp_path = config_dir.join(format!(
        ".{AGENT_NOISE_CONFIG_FILE_NAME}.tmp-{}-{}",
        std::process::id(),
        now_unix_ms()
    ));

    let encoded = encode_agent_material(material)?;
    fs::write(&temp_path, encoded)?;
    set_secret_file_permissions(&temp_path)?;
    fs::rename(&temp_path, &target_path)?;
    set_secret_file_permissions(&target_path)?;

    let _ = load_agent_material_from_file(&target_path)?;
    Ok(target_path)
}

fn prepare_config_dir(config_dir: &Path) -> Result<(), WslLinkAgentInstallError> {
    fs::create_dir_all(config_dir)?;
    if !config_dir.is_dir() {
        return Err(WslLinkAgentInstallError::TargetIsNotDirectory(
            config_dir.to_path_buf(),
        ));
    }
    set_secret_dir_permissions(config_dir)?;
    Ok(())
}

#[cfg(unix)]
fn set_secret_dir_permissions(path: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_secret_dir_permissions(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

#[cfg(unix)]
fn set_secret_file_permissions(path: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_secret_file_permissions(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        super::noise_material::{generate_pairing_material, load_agent_material_from_file},
        install_agent_noise_material, WslLinkAgentInstallPlan, AGENT_NOISE_CONFIG_FILE_NAME,
        DEFAULT_AGENT_CONFIG_DIR,
    };

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "calamex-wsl-link-agent-install-{name}-{}-{}",
            std::process::id(),
            super::now_unix_ms()
        ))
    }

    #[test]
    fn default_install_plan_matches_agent_runtime_path() {
        let plan = WslLinkAgentInstallPlan::default_linux();

        assert_eq!(
            plan.config_dir,
            std::path::PathBuf::from(DEFAULT_AGENT_CONFIG_DIR)
        );
        assert_eq!(
            plan.noise_config_path,
            std::path::PathBuf::from(super::DEFAULT_AGENT_NOISE_CONFIG_PATH)
        );
    }

    #[test]
    fn install_agent_noise_material_writes_loadable_config() {
        let dir = temp_dir("write-loadable");
        let material = generate_pairing_material().expect("pairing material should generate");

        let path =
            install_agent_noise_material(&dir, &material.agent).expect("install should work");
        let loaded = load_agent_material_from_file(&path).expect("installed material should load");

        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some(AGENT_NOISE_CONFIG_FILE_NAME)
        );
        assert_eq!(loaded, material.agent);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn install_agent_noise_material_rejects_file_target_dir() {
        let dir = temp_dir("file-target");
        let material = generate_pairing_material().expect("pairing material should generate");

        fs::write(&dir, "not-a-dir").expect("test file should write");
        let result = install_agent_noise_material(&dir, &material.agent);

        assert!(result.is_err());
        let _ = fs::remove_file(dir);
    }
}
