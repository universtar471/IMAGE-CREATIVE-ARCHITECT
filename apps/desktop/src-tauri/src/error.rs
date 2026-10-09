//! Typed application errors returned across the Tauri bridge.
//! Messages are user-facing and actionable; no stack traces reach the UI.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NotFound,
    ValidationError,
    IoError,
    DbError,
    Conflict,
    UnsupportedFile,
    InvalidState,
    DuplicateAsset,
    ProviderNotConfigured,
    /// A provider call made directly by a command (not a queued job) failed; details carry
    /// `{ providerId, kind, retryable }`.
    ProviderError,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{code:?}: {message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), details: None }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn not_found(what: &str, id: &str) -> Self {
        Self::new(ErrorCode::NotFound, format!("{what} '{id}' was not found."))
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ValidationError, message)
    }

    pub fn invalid_state(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidState, message)
    }

    pub fn io(context: &str, err: std::io::Error) -> Self {
        Self::new(ErrorCode::IoError, format!("{context}: {err}"))
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::new(ErrorCode::DbError, format!("Database error: {err}"))
    }
}

pub type AppResult<T> = Result<T, AppError>;
