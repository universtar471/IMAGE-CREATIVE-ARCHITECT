//! Backend DNA validation against the JSON Schema exported from the Zod source of truth
//! (`packages/domain/schema/project-dna.schema.json`). The UI validates with Zod first;
//! this is the persistence gate so invalid JSON can never reach SQLite.

use std::sync::OnceLock;

use serde_json::{json, Map, Value};

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
    validate_additive_fields(dna, &mut field_errors);
    // P4.1 fields are additive and the schema in a pre-P4-A checkout does not know
    // them yet. Remove only those fields for the old-schema pass; their own types
    // are checked above and the persisted value remains untouched.
    let mut schema_input = dna.clone();
    strip_additive_fields(&mut schema_input);
    for err in validator().iter_errors(&schema_input) {
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

fn strip_additive_fields(dna: &mut Value) {
    if let Some(object) = dna.as_object_mut() {
        if let Some(section) = object.get_mut("lighting").and_then(Value::as_object_mut) {
            section.remove("presetId");
            if let Some(lights) = section.get_mut("artificialLighting").and_then(Value::as_array_mut) {
                for light in lights {
                    if let Some(light) = light.as_object_mut() {
                        light.remove("id");
                        light.remove("enabled");
                    }
                }
            }
        }
        for section_name in ["weather", "mood"] {
            if let Some(section) = object.get_mut(section_name).and_then(Value::as_object_mut) {
                section.remove("presetId");
            }
        }
        if let Some(locks) = object.get_mut("locks").and_then(Value::as_object_mut) {
            locks.remove("mood");
        }
    }
}

fn additive_error(field_errors: &mut Map<String, Value>, path: &str, message: &str) {
    field_errors.entry(path.to_string()).or_insert_with(|| Value::String(message.to_string()));
}

fn validate_additive_fields(dna: &Value, field_errors: &mut Map<String, Value>) {
    let Some(root) = dna.as_object() else { return };
    for section_name in ["lighting", "weather", "mood"] {
        let Some(section) = root.get(section_name) else { continue };
        let Some(section) = section.as_object() else {
            additive_error(field_errors, section_name, "Expected an object.");
            continue;
        };
        if let Some(preset) = section.get("presetId") {
            if !preset.is_string() {
                additive_error(field_errors, &format!("{section_name}.presetId"), "Expected a string.");
            }
        }
    }
    if let Some(lighting) = root.get("lighting").and_then(Value::as_object) {
        if let Some(lights) = lighting.get("artificialLighting") {
            if let Some(lights) = lights.as_array() {
                for (index, light) in lights.iter().enumerate() {
                    let Some(light) = light.as_object() else { continue };
                    if let Some(id) = light.get("id") {
                        let valid = id.as_str().is_some_and(|id| {
                            id.starts_with("LGT_")
                                && id.len() == 30
                                && matches!(id.as_bytes().get(4), Some(b'0'..=b'7'))
                                && id[4..].bytes().all(|b| {
                                    b.is_ascii_digit()
                                        || b.is_ascii_uppercase() && !matches!(b, b'I' | b'L' | b'O' | b'U')
                                })
                        });
                        if !valid {
                            additive_error(
                                field_errors,
                                &format!("lighting.artificialLighting[{index}].id"),
                                "Expected an LGT_<ULID> id.",
                            );
                        }
                    }
                    if let Some(enabled) = light.get("enabled") {
                        if !enabled.is_boolean() {
                            additive_error(
                                field_errors,
                                &format!("lighting.artificialLighting[{index}].enabled"),
                                "Expected a boolean.",
                            );
                        }
                    }
                }
            } else {
                additive_error(field_errors, "lighting.artificialLighting", "Expected an array.");
            }
        }
    }
    if let Some(mood) = root.get("locks").and_then(Value::as_object).and_then(|locks| locks.get("mood")) {
        if !mood.is_boolean() {
            additive_error(field_errors, "locks.mood", "Expected a boolean.");
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn minimal() -> Value {
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
