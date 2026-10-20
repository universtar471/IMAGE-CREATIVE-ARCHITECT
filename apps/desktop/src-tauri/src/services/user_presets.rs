//! "My presets" (M2, ADR-040): saved combinations of shot presets, shared by every project.
//!
//! Only the ids are stored; the catalog that gives them meaning lives in the TypeScript domain
//! (`packages/domain/src/presets/catalog.ts`). The backend checks the shape of each id, not
//! whether the catalog still knows it: an unknown id is skipped when the combination is
//! applied, so renaming a preset never breaks a saved row.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, ErrorCode};
use crate::services::AppCore;
use crate::util::{new_id, prefix};

pub const MAX_NAME_CHARS: usize = 60;
pub const MAX_PRESET_IDS: usize = 24;
const MAX_ID_CHARS: usize = 64;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserPresetDto {
    pub id: String,
    pub name: String,
    pub preset_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    /// Absent: create a new combination.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub preset_ids: Vec<String>,
}

const COLUMNS: &str = "id, name, preset_ids, created_at, updated_at";

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, String, String)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
}

fn dto((id, name, ids, created_at, updated_at): (String, String, String, String, String)) -> AppResult<UserPresetDto> {
    let preset_ids: Vec<String> = serde_json::from_str(&ids)
        .map_err(|_| AppError::new(ErrorCode::DbError, format!("Saved preset '{id}' has unreadable preset ids.")))?;
    Ok(UserPresetDto { id, name, preset_ids, created_at, updated_at })
}

/// Lowercase letters, digits, `.` and `_` (the shape of every catalog id, e.g. `time.golden_hour`).
fn valid_preset_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_CHARS
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_')
}

fn validate(request: &SaveRequest) -> AppResult<(String, Vec<String>)> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Give the preset combination a name."));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::validation(format!("The name is longer than {MAX_NAME_CHARS} characters.")));
    }
    let mut ids: Vec<String> = Vec::new();
    for id in &request.preset_ids {
        if !valid_preset_id(id) {
            return Err(AppError::validation(format!("'{id}' is not a valid preset id.")));
        }
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }
    if ids.is_empty() {
        return Err(AppError::validation("Select at least one preset before saving the combination."));
    }
    if ids.len() > MAX_PRESET_IDS {
        return Err(AppError::validation(format!("A combination holds at most {MAX_PRESET_IDS} presets.")));
    }
    Ok((name.to_string(), ids))
}

pub fn list(core: &AppCore) -> AppResult<Vec<UserPresetDto>> {
    let conn = core.conn()?;
    let mut stmt =
        conn.prepare(&format!("SELECT {COLUMNS} FROM user_presets ORDER BY name COLLATE NOCASE, created_at, id"))?;
    let rows = stmt.query_map([], read_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(dto).collect()
}

fn find(conn: &rusqlite::Connection, id: &str) -> AppResult<UserPresetDto> {
    let row =
        conn.query_row(&format!("SELECT {COLUMNS} FROM user_presets WHERE id = ?1"), [id], read_row).map_err(|e| {
            match e {
                rusqlite::Error::QueryReturnedNoRows => AppError::not_found("Saved preset", id),
                other => other.into(),
            }
        })?;
    dto(row)
}

pub fn save(core: &AppCore, request: SaveRequest) -> AppResult<UserPresetDto> {
    let (name, ids) = validate(&request)?;
    let ids_json = serde_json::to_string(&ids).expect("a string list always serializes");
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let now = core.now_iso();
    let id = match request.id {
        Some(id) => {
            let updated = tx.execute(
                "UPDATE user_presets SET name = ?1, preset_ids = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![name, ids_json, now, id],
            )?;
            if updated == 0 {
                return Err(AppError::not_found("Saved preset", &id));
            }
            id
        }
        None => {
            let id = new_id(prefix::USER_PRESET);
            tx.execute(
                "INSERT INTO user_presets (id, name, preset_ids, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                rusqlite::params![id, name, ids_json, now],
            )?;
            id
        }
    };
    let saved = find(&tx, &id)?;
    tx.commit()?;
    Ok(saved)
}

/// Removes one saved combination; the UI asks for confirmation first.
pub fn delete(core: &AppCore, id: &str) -> AppResult<()> {
    let conn = core.conn()?;
    let removed = conn.execute("DELETE FROM user_presets WHERE id = ?1", [id])?;
    if removed == 0 {
        return Err(AppError::not_found("Saved preset", id));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::tests_support::core;

    fn request(id: Option<&str>, name: &str, ids: &[&str]) -> SaveRequest {
        SaveRequest {
            id: id.map(String::from),
            name: name.into(),
            preset_ids: ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn saves_lists_updates_and_deletes_a_combination() {
        let (_tmp, core) = core();
        assert!(list(&core).unwrap().is_empty());
        let saved =
            save(&core, request(None, "  Dusk street  ", &["time.blue_hour", "people.walking", "time.blue_hour"]))
                .unwrap();
        assert!(saved.id.starts_with("UPR_"));
        assert_eq!(saved.name, "Dusk street");
        assert_eq!(saved.preset_ids, vec!["time.blue_hour", "people.walking"]);

        save(&core, request(None, "Aerial noon", &["camera.aerial", "time.midday"])).unwrap();
        let names: Vec<String> = list(&core).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["Aerial noon", "Dusk street"]);

        let updated = save(&core, request(Some(&saved.id), "Dusk", &["time.night"])).unwrap();
        assert_eq!(updated.id, saved.id);
        assert_eq!(updated.preset_ids, vec!["time.night"]);
        assert_eq!(updated.created_at, saved.created_at);

        delete(&core, &saved.id).unwrap();
        assert_eq!(list(&core).unwrap().len(), 1);
        assert_eq!(delete(&core, &saved.id).unwrap_err().code, ErrorCode::NotFound);
    }

    #[test]
    fn rejects_invalid_names_and_ids() {
        let (_tmp, core) = core();
        for bad in [
            request(None, " ", &["time.night"]),
            request(None, &"x".repeat(61), &["time.night"]),
            request(None, "Empty", &[]),
            request(None, "Path", &["../time"]),
            request(None, "Upper", &["Time.Night"]),
        ] {
            assert_eq!(save(&core, bad).unwrap_err().code, ErrorCode::ValidationError);
        }
        let many: Vec<String> = (0..25).map(|i| format!("p.{i}")).collect();
        let too_many = SaveRequest { id: None, name: "Many".into(), preset_ids: many };
        assert_eq!(save(&core, too_many).unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(
            save(&core, request(Some("UPR_missing"), "X", &["time.night"])).unwrap_err().code,
            ErrorCode::NotFound
        );
        assert!(list(&core).unwrap().is_empty());
    }
}
