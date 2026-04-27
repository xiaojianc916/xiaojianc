use std::path::Path;

/// 将 Windows 路径中的扩展路径前缀归一化为常规本地路径。
pub fn normalize_windows_path_for_wsl(value: &str) -> Result<String, String> {
    if let Some(network_path) = value.strip_prefix("\\\\?\\UNC\\") {
        return Err(format!(
            "暂不支持将网络共享路径转换为 WSL 路径：\\\\{}",
            network_path
        ));
    }

    if let Some(extended_path) = value.strip_prefix("\\\\?\\") {
        return Ok(extended_path.to_string());
    }

    Ok(value.to_string())
}

/// 将 Windows 本地磁盘路径转换为 WSL `/mnt/<drive>/...` 路径。
pub fn to_wsl_path(path: &Path) -> Result<String, String> {
    let normalized = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    let normalized = normalize_windows_path_for_wsl(&normalized)?;

    let drive_letter = normalized
        .chars()
        .next()
        .ok_or_else(|| "无法识别 Windows 路径。".to_string())?;

    if !drive_letter.is_ascii_alphabetic() || !normalized.contains(':') {
        return Err("仅支持 Windows 本地磁盘路径转换为 WSL 路径。".into());
    }

    let rest = normalized
        .get(2..)
        .ok_or_else(|| "Windows 路径格式无效。".to_string())?;

    Ok(format!(
        "/mnt/{}/{}",
        drive_letter.to_ascii_lowercase(),
        rest.replace('\\', "/").trim_start_matches('/'),
    ))
}

/// 对即将插入 bash 命令行的字符串做单引号转义。
pub fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
