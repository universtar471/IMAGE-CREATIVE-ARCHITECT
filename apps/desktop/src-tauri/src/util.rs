use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};

/// RFC 3339 UTC timestamp with millisecond precision, e.g. `2026-10-08T05:30:00.123Z`.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Process-wide monotonic ULID source. Plain `Ulid::generate()` is random within one
/// millisecond, and rows created in the same millisecond share `created_at`; lists order by
/// `created_at, id`, so IDs must also sort in creation order.
static ID_GENERATOR: Mutex<ulid::Generator> = Mutex::new(ulid::Generator::new());

/// Stable application ID: `<PREFIX>_<ULID>`. Strictly increasing within the process: an ID
/// created later always sorts after an earlier one (also across threads).
pub fn new_id(prefix: &str) -> String {
    // A poisoned lock only means another thread panicked mid-call; the generator state is
    // still a valid previous ULID, so keep using it.
    let mut generator = ID_GENERATOR.lock().unwrap_or_else(|e| e.into_inner());
    // Overflow (2^80 IDs in one millisecond) borrows from the next millisecond, which keeps
    // the order instead of failing.
    let id = generator.generate().unwrap_or_else(|overflow| overflow.commit_overflow_increment());
    format!("{prefix}_{id}")
}

pub mod prefix {
    pub const GENERATION: &str = "GEN";
    pub const PROJECT: &str = "PRJ";
    pub const ASSET: &str = "AST";
    pub const VERSION: &str = "VER";
    pub const JOB: &str = "JOB";
    pub const BATCH: &str = "BAT";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_created_later_always_sort_after_earlier_ones() {
        // Thousands per millisecond: plain random ULIDs would interleave within one ms.
        let ids: Vec<String> = (0..20_000).map(|_| new_id(prefix::ASSET)).collect();
        for pair in ids.windows(2) {
            assert!(pair[0] < pair[1], "{} !< {}", pair[0], pair[1]);
        }
    }

    #[test]
    fn ids_stay_increasing_across_threads() {
        let handles: Vec<_> =
            (0..4).map(|_| std::thread::spawn(|| (0..2_000).map(|_| new_id("T")).collect::<Vec<_>>())).collect();
        for ids in handles.into_iter().map(|h| h.join().unwrap()) {
            assert!(ids.windows(2).all(|p| p[0] < p[1]));
        }
    }
}
