//! Backend DNA validation against the JSON Schema exported from the Zod source of truth
//! (`packages/domain/schema/project-dna.schema.json`). The UI validates with Zod first;
//! this is the persistence gate so invalid JSON can never reach SQLite.

use std::sync::OnceLock;

use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

const SCHEMA_TEXT: &str = include_str!("../../../../../packages/domain/schema/project-dna.schema.json");

fn validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let schema: Value = serde_json::from_str(SCHEMA_TEXT).expect("embedded DNA schema is valid JSON");
        jsonschema::validator_for(&schema).expect("embedded DNA schema compiles")
    })
}

/// Validate a complete DNA aggregate. Field errors are keyed by dotted path
/// (`building.floors`) to match the frontend's Zod error keys.
pub fn validate_dna(dna: &Value) -> AppResult<()> {
    let mut field_errors = serde_json::Map::new();
    for err in validator().iter_errors(dna) {
        let pointer = err.instance_path().to_string();
        let key = pointer.trim_start_matches('/').replace('/', ".");
        let key = if key.is_empty() { "(root)".to_string() } else { key };
        field_errors.entry(key).or_insert_with(|| Value::String(err.to_string()));
    }
    if field_errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::validation("The design DNA has invalid values and was not saved.")
            .with_details(json!({ "fieldErrors": field_errors })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal() -> Value {
        json!({
            "schemaVersion": 1,
            "building": {
                "schemaVersion": 1, "buildingType": "villa", "dimensions": {},
                "massing": { "voids": [] }, "roof": {}, "openings": {},
                "materials": [], "colorPalette": [], "specialFeatures": [], "notes": ""
            },
            "context": {
                "schemaVersion": 1,
                "front": { "elements": [], "vegetation": [], "adjacentBuildings": [], "notes": "" },
                "rear": { "elements": [], "vegetation": [], "adjacentBuildings": [], "notes": "" },
                "left": { "elements": [], "vegetation": [], "adjacentBuildings": [], "notes": "" },
                "right": { "elements": [], "vegetation": [], "adjacentBuildings": [], "notes": "" },
                "distantBackground": [], "atmosphereNotes": "", "negativeConstraints": []
            },
            "cameras": [],
            "locks": { "building": false, "context": false, "camera": false, "lighting": false,
                       "weather": false, "colorGrade": false, "objectIds": [] }
        })
    }

    pub(crate) fn valid_dna() -> Value {
        minimal()
    }

    #[test]
    fn accepts_complete_minimal_dna() {
        validate_dna(&minimal()).unwrap();
    }

    #[test]
    fn rejects_negative_dimensions_and_bad_floors() {
        let mut dna = minimal();
        dna["building"]["dimensions"]["widthM"] = json!(-4);
        dna["building"]["floors"] = json!(0);
        let err = validate_dna(&dna).unwrap_err();
        let fields = &err.details.unwrap()["fieldErrors"];
        assert!(fields.get("building.dimensions.widthM").is_some(), "{fields}");
        assert!(fields.get("building.floors").is_some(), "{fields}");
    }

    #[test]
    fn rejects_unknown_density_and_wrong_version() {
        let mut dna = minimal();
        dna["context"]["density"] = json!("crowded");
        dna["schemaVersion"] = json!(2);
        assert!(validate_dna(&dna).is_err());
    }

    #[test]
    fn rejects_missing_sections() {
        assert!(validate_dna(&json!({ "schemaVersion": 1 })).is_err());
    }
}

#[cfg(test)]
pub(crate) use tests::valid_dna as test_valid_dna;
