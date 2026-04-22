use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{message}")]
    NotFound { message: String },
    #[error("{message}")]
    Tauri { message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppErrorPayload {
    code: &'static str,
    message: String,
}

impl AppError {
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound {
            message: message.into(),
        }
    }

    pub fn tauri(error: impl std::fmt::Display) -> Self {
        Self::Tauri {
            message: error.to_string(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound { .. } => "window.not-found",
            Self::Tauri { .. } => "window.tauri-error",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        AppErrorPayload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
