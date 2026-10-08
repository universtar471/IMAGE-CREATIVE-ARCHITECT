use chrono::{SecondsFormat, Utc};

/// RFC 3339 UTC timestamp with millisecond precision, e.g. `2026-10-08T05:30:00.123Z`.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Stable application ID: `<PREFIX>_<ULID>`.
pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", ulid::Ulid::generate())
}

pub mod prefix {
    pub const PROJECT: &str = "PRJ";
    pub const ASSET: &str = "AST";
    pub const VERSION: &str = "VER";
}
