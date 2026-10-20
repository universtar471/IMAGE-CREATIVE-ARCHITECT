//! Branch canvas node positions (M3, ADR-041). The graph is derived in the webview from
//! generations and assets; only where the user dragged the nodes is stored, one JSON row per
//! project: `{ "version": 1, "positions": { "<nodeId>": { "x": 0, "y": 0 } } }`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::repositories;
use crate::services::{ensure_not_archived, AppCore};

/// Largest stored layout; thousands of nodes stay far below it.
pub const MAX_LAYOUT_BYTES: usize = 512 * 1024;
const MAX_NODE_ID_CHARS: usize = 128;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasLayoutDto {
    pub project_id: String,
    pub layout: Value,
    /// Absent until the first save.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub project_id: String,
    pub layout: Value,
}

fn empty() -> Value {
    json!({ "version": 1, "positions": {} })
}

/// `version` 1 and a `positions` object of finite `{ x, y }` numbers under short node ids.
fn validate(layout: &Value) -> AppResult<()> {
    let invalid = |why: &str| AppError::validation(format!("The canvas layout is invalid: {why}."));
    if layout.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(invalid("version must be 1"));
    }
    let positions = layout.get("positions").and_then(Value::as_object).ok_or_else(|| invalid("positions missing"))?;
    for (id, point) in positions {
        if id.is_empty() || id.len() > MAX_NODE_ID_CHARS {
            return Err(invalid("a node id is empty or too long"));
        }
        let finite = |key: &str| point.get(key).and_then(Value::as_f64).is_some_and(f64::is_finite);
        if !finite("x") || !finite("y") {
            return Err(invalid("a position is not a pair of numbers"));
        }
    }
    if layout.as_object().is_some_and(|o| o.len() != 2) {
        return Err(invalid("only version and positions are allowed"));
    }
    Ok(())
}

pub fn get(core: &AppCore, project_id: &str) -> AppResult<CanvasLayoutDto> {
    let conn = core.conn()?;
    repositories::get_project(&conn, project_id)?;
    let row = conn.query_row("SELECT json, updated_at FROM canvas_layouts WHERE project_id = ?1", [project_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    });
    match row {
        Ok((text, updated_at)) => Ok(CanvasLayoutDto {
            project_id: project_id.into(),
            // A row that no longer parses is treated as empty instead of breaking the canvas.
            layout: serde_json::from_str::<Value>(&text).ok().filter(|v| validate(v).is_ok()).unwrap_or_else(empty),
            updated_at: Some(updated_at),
        }),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Ok(CanvasLayoutDto { project_id: project_id.into(), layout: empty(), updated_at: None })
        }
        Err(e) => Err(e.into()),
    }
}

pub fn save(core: &AppCore, request: SaveRequest) -> AppResult<CanvasLayoutDto> {
    validate(&request.layout)?;
    let text = request.layout.to_string();
    if text.len() > MAX_LAYOUT_BYTES {
        return Err(AppError::validation("The canvas layout is too large to save; use Re-arrange to reset it."));
    }
    {
        let conn = core.conn()?;
        ensure_not_archived(&repositories::get_project(&conn, &request.project_id)?)?;
        conn.execute(
            "INSERT INTO canvas_layouts (project_id, json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(project_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
            rusqlite::params![request.project_id, text, core.now_iso()],
        )?;
    }
    get(core, &request.project_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::services::projects;
    use crate::services::tests_support::{core, test_create_villa_unconfirmed};

    #[test]
    fn starts_empty_saves_and_reads_back() {
        let (_tmp, core) = core();
        let project = test_create_villa_unconfirmed(&core, "Canvas");
        let first = get(&core, &project.id).unwrap();
        assert_eq!(first.layout, empty());
        assert_eq!(first.updated_at, None);
        let layout = json!({ "version": 1, "positions": { "gen:GEN_1": { "x": 10.5, "y": -3 } } });
        let saved = save(&core, SaveRequest { project_id: project.id.clone(), layout: layout.clone() }).unwrap();
        assert_eq!(saved.layout, layout);
        assert!(saved.updated_at.is_some());
        assert_eq!(get(&core, &project.id).unwrap().layout, layout);
    }

    #[test]
    fn rejects_invalid_layouts_and_archived_projects() {
        let (_tmp, core) = core();
        let project = test_create_villa_unconfirmed(&core, "Canvas");
        for bad in [
            json!({ "version": 2, "positions": {} }),
            json!({ "version": 1 }),
            json!({ "version": 1, "positions": { "a": { "x": "1", "y": 0 } } }),
            json!({ "version": 1, "positions": { "": { "x": 1, "y": 0 } } }),
            json!({ "version": 1, "positions": {}, "extra": true }),
        ] {
            let err = save(&core, SaveRequest { project_id: project.id.clone(), layout: bad }).unwrap_err();
            assert_eq!(err.code, ErrorCode::ValidationError);
        }
        let huge: serde_json::Map<String, Value> =
            (0..20_000).map(|i| (format!("asset:AST_{i:026}"), json!({ "x": i, "y": i }))).collect();
        let err = save(
            &core,
            SaveRequest { project_id: project.id.clone(), layout: json!({ "version": 1, "positions": huge }) },
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);

        projects::set_archived(&core, &project.id, true).unwrap();
        let err = save(&core, SaveRequest { project_id: project.id.clone(), layout: empty() }).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidState);
        assert_eq!(get(&core, "PRJ_missing").unwrap_err().code, ErrorCode::NotFound);
    }
}
