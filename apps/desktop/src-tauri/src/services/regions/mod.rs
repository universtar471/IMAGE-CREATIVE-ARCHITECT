pub mod mask;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::repositories;
use crate::services::{ensure_not_archived, AppCore};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum RegionShape {
    Rect { x: f64, y: f64, w: f64, h: f64 },
    Polygon { points: Vec<[f64; 2]> },
    Brush { strokes: Vec<BrushStroke> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrushStroke {
    pub points: Vec<[f64; 2]>,
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegionDto {
    pub id: String,
    pub project_id: String,
    pub asset_id: String,
    pub label: String,
    pub kind: String,
    pub object_id: Option<String>,
    pub shape: RegionShape,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionInput {
    pub id: Option<String>,
    pub label: String,
    pub kind: String,
    pub object_id: Option<String>,
    pub shape: RegionShape,
}

fn validate_number(v: f64, name: &str) -> AppResult<()> {
    if !v.is_finite() || !(0.0..=1.0).contains(&v) {
        return Err(AppError::validation(format!("{name} must be finite and between 0 and 1.")));
    }
    Ok(())
}
fn validate_shape(shape: &RegionShape) -> AppResult<()> {
    match shape {
        RegionShape::Rect { x, y, w, h } => {
            for (v, n) in [(*x, "x"), (*y, "y"), (*w, "w"), (*h, "h")] {
                validate_number(v, n)?;
            }
            if *w <= 0.0 || *h <= 0.0 || x + w > 1.0 || y + h > 1.0 {
                return Err(AppError::validation("Rectangle must be positive and fit within 0..1."));
            }
        }
        RegionShape::Polygon { points } => {
            if points.len() < 3 {
                return Err(AppError::validation("Polygon requires at least 3 points."));
            }
            for p in points {
                validate_number(p[0], "polygon x")?;
                validate_number(p[1], "polygon y")?;
            }
        }
        RegionShape::Brush { strokes } => {
            for s in strokes {
                if s.points.is_empty() {
                    return Err(AppError::validation("Brush strokes require at least one point."));
                }
                if !s.radius.is_finite() || s.radius <= 0.0 || s.radius > 1.0 {
                    return Err(AppError::validation("Brush radius must be greater than zero and at most 1."));
                }
                for p in &s.points {
                    validate_number(p[0], "brush x")?;
                    validate_number(p[1], "brush y")?;
                }
            }
        }
    }
    Ok(())
}
fn dto(row: &rusqlite::Row<'_>) -> rusqlite::Result<RegionDto> {
    let shape: RegionShape = serde_json::from_str(&row.get::<_, String>(6)?)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e)))?;
    Ok(RegionDto {
        id: row.get(0)?,
        project_id: row.get(1)?,
        asset_id: row.get(2)?,
        label: row.get(3)?,
        kind: row.get(4)?,
        object_id: row.get(5)?,
        shape,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub fn list(core: &AppCore, project_id: &str, asset_id: &str) -> AppResult<Vec<RegionDto>> {
    let conn = core.conn()?;
    let project = repositories::get_project(&conn, project_id)?;
    ensure_not_archived(&project)?;
    if repositories::find_asset(&conn, asset_id)?.is_none_or(|a| a.project_id != project_id) {
        return Err(AppError::not_found("Asset", asset_id));
    }
    let mut stmt=conn.prepare("SELECT id, project_id, asset_id, label, kind, object_id, shape_json, created_at, updated_at FROM regions WHERE project_id=?1 AND asset_id=?2 ORDER BY created_at,id")?;
    let rows = stmt.query_map(rusqlite::params![project_id, asset_id], dto)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
pub fn save(core: &AppCore, project_id: &str, asset_id: &str, input: RegionInput) -> AppResult<RegionDto> {
    validate_shape(&input.shape)?;
    if !matches!(input.kind.as_str(), "object" | "zone" | "material") {
        return Err(AppError::validation("Region kind must be object, zone or material."));
    }
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repositories::get_project(&tx, project_id)?;
    ensure_not_archived(&project)?;
    let asset = repositories::find_asset(&tx, asset_id)?
        .filter(|a| a.project_id == project_id)
        .ok_or_else(|| AppError::not_found("Asset", asset_id))?;
    let dna = repositories::get_dna(&tx, project_id)?;
    if let Some(object_id) = &input.object_id {
        let found = dna
            .pointer("/scene/objects")
            .and_then(Value::as_array)
            .is_some_and(|os| os.iter().any(|o| o.get("id").and_then(Value::as_str) == Some(object_id)));
        if !found {
            return Err(AppError::validation(format!("Scene object '{object_id}' was not found.")));
        }
    }
    let now = core.now_iso();
    let id = input.id.unwrap_or_else(|| crate::util::new_id(crate::util::prefix::REGION));
    if let Ok(existing) = tx.query_row("SELECT project_id,asset_id FROM regions WHERE id=?1", [&id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        if existing != (project_id.to_string(), asset_id.to_string()) {
            return Err(AppError::validation(format!("Region '{id}' belongs to a different asset.")));
        }
    }
    let shape_json = serde_json::to_string(&input.shape).map_err(|e| AppError::validation(e.to_string()))?;
    tx.execute("INSERT INTO regions (id,project_id,asset_id,label,kind,object_id,shape_json,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(id) DO UPDATE SET label=excluded.label,kind=excluded.kind,object_id=excluded.object_id,shape_json=excluded.shape_json,updated_at=excluded.updated_at",rusqlite::params![id,project_id,asset.id,input.label,input.kind,input.object_id,shape_json,now])?;
    let result = tx.query_row(
        "SELECT id,project_id,asset_id,label,kind,object_id,shape_json,created_at,updated_at FROM regions WHERE id=?1",
        [&id],
        dto,
    )?;
    tx.commit()?;
    Ok(result)
}
pub fn delete(core: &AppCore, project_id: &str, region_id: &str) -> AppResult<()> {
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repositories::get_project(&tx, project_id)?;
    ensure_not_archived(&project)?;
    let n =
        tx.execute("DELETE FROM regions WHERE id=?1 AND project_id=?2", rusqlite::params![region_id, project_id])?;
    if n == 0 {
        return Err(AppError::not_found("Region", region_id));
    }
    tx.commit()?;
    Ok(())
}

pub fn get_for_asset(
    conn: &rusqlite::Connection,
    project_id: &str,
    asset_id: &str,
    ids: &[String],
) -> AppResult<Vec<RegionDto>> {
    let mut out = Vec::new();
    for id in ids {
        let row=conn.query_row("SELECT id,project_id,asset_id,label,kind,object_id,shape_json,created_at,updated_at FROM regions WHERE id=?1 AND project_id=?2",rusqlite::params![id,project_id],dto).map_err(|_|AppError::not_found("Region",id))?;
        if row.asset_id != asset_id {
            return Err(AppError::validation(format!("Region '{id}' does not belong to the selected asset.")));
        }
        out.push(row);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{validate_shape, BrushStroke, RegionShape};

    #[test]
    fn brush_strokes_require_at_least_one_point() {
        let empty = RegionShape::Brush { strokes: vec![BrushStroke { points: vec![], radius: 0.1 }] };
        assert!(validate_shape(&empty).is_err());
        let one = RegionShape::Brush { strokes: vec![BrushStroke { points: vec![[0.5, 0.5]], radius: 0.1 }] };
        assert!(validate_shape(&one).is_ok());
    }
}
