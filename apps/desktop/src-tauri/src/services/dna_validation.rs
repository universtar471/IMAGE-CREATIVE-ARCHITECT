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
    apply_additive_defaults(&mut schema_input);
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

fn apply_additive_defaults(dna: &mut Value) {
    if let Some(lights) = dna
        .get_mut("lighting")
        .and_then(Value::as_object_mut)
        .and_then(|section| section.get_mut("artificialLighting"))
        .and_then(Value::as_array_mut)
    {
        for light in lights {
            if let Some(light) = light.as_object_mut() {
                light.entry("enabled").or_insert_with(|| Value::Bool(true));
            }
        }
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
        if let Some(context) = object.get_mut("context").and_then(Value::as_object_mut) {
            context.remove("siteTopology");
        }
    }
}

fn additive_error(field_errors: &mut Map<String, Value>, path: &str, message: &str) {
    field_errors.entry(path.to_string()).or_insert_with(|| Value::String(message.to_string()));
}

fn validate_additive_fields(dna: &Value, field_errors: &mut Map<String, Value>) {
    let Some(root) = dna.as_object() else { return };
    validate_interior_room(root, field_errors);
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
    validate_site_topology(root, field_errors);
    validate_space_catalog(root, field_errors);
}

/// The two refinements the JSON schema cannot express (ADR-034, mirrored from the Zod
/// `SpaceCatalogExtensionSchema`): space ids are unique and `activeSpaceId` names one of them.
/// Shape errors (missing ids, wrong types) are left to the schema pass.
fn validate_space_catalog(root: &Map<String, Value>, field_errors: &mut Map<String, Value>) {
    let Some(catalog) = root.get("spaceCatalog").and_then(Value::as_object) else { return };
    let Some(spaces) = catalog.get("spaces").and_then(Value::as_array) else { return };
    let mut seen = std::collections::HashSet::new();
    for (index, space) in spaces.iter().enumerate() {
        let Some(id) = space.get("id").and_then(Value::as_str) else { continue };
        if !seen.insert(id) {
            additive_error(field_errors, &format!("spaceCatalog.spaces.{index}.id"), "Space ids must be unique.");
        }
    }
    if let Some(active) = catalog.get("activeSpaceId").and_then(Value::as_str) {
        if !seen.contains(active) {
            additive_error(field_errors, "spaceCatalog.activeSpaceId", "activeSpaceId must name one of the spaces.");
        }
    }
}

fn validate_site_topology(root: &Map<String, Value>, field_errors: &mut Map<String, Value>) {
    let Some(topology) = root.get("context").and_then(Value::as_object).and_then(|context| context.get("siteTopology"))
    else {
        return;
    };
    let Some(topology) = topology.as_object() else {
        additive_error(field_errors, "context.siteTopology", "Expected an object.");
        return;
    };
    for side in ["left", "right"] {
        if let Some(value) = topology.get(side) {
            if !matches!(value.as_str(), Some("attached" | "open" | "unknown")) {
                additive_error(
                    field_errors,
                    &format!("context.siteTopology.{side}"),
                    "Expected attached, open, or unknown.",
                );
            }
        }
    }
    if let Some(corner_lot) = topology.get("cornerLot") {
        if !corner_lot.is_boolean() {
            additive_error(field_errors, "context.siteTopology.cornerLot", "Expected a boolean.");
        }
    }
    let corner_side_value = topology.get("cornerSide");
    let corner_side = corner_side_value.and_then(Value::as_str);
    if corner_side_value.is_some() && corner_side.is_none() {
        additive_error(field_errors, "context.siteTopology.cornerSide", "Expected left or right.");
    }
    if let Some(side) = corner_side {
        if !matches!(side, "left" | "right") {
            additive_error(field_errors, "context.siteTopology.cornerSide", "Expected left or right.");
        }
    }
    if topology.get("cornerLot").and_then(Value::as_bool) == Some(true) {
        let Some(side) = corner_side else {
            additive_error(field_errors, "context.siteTopology.cornerSide", "cornerSide is required for a corner lot.");
            return;
        };
        if topology.get(side).and_then(Value::as_str) == Some("attached") {
            additive_error(field_errors, "context.siteTopology.cornerSide", "cornerSide must not be attached.");
        }
    }
}

fn validate_interior_room(root: &Map<String, Value>, field_errors: &mut Map<String, Value>) {
    let Some(interior) = root.get("interior").and_then(Value::as_object) else {
        return;
    };
    let (Some(building_use), Some(room)) =
        (interior.get("buildingUseId").and_then(Value::as_str), interior.get("roomId").and_then(Value::as_str))
    else {
        return;
    };
    if room == "other" {
        return;
    }
    const RESIDENTIAL: &[&str] = &[
        "living_room",
        "kitchen",
        "dining_room",
        "living_kitchen",
        "master_bedroom",
        "bedroom",
        "kids_room",
        "bathroom",
        "walk_in_closet",
        "home_office",
        "prayer_room",
    ];
    const STUDIO: &[&str] = &["living_kitchen", "bedroom", "bathroom", "walk_in_closet", "home_office"];
    const HOSPITALITY: &[&str] = &[
        "master_bedroom",
        "bedroom",
        "bathroom",
        "living_room",
        "lobby",
        "reception",
        "cafe_dining",
        "bar_counter",
        "spa_treatment",
    ];
    let valid = match building_use {
        "apartment" | "duplex_penthouse" | "single_storey_house" => RESIDENTIAL.contains(&room),
        "townhouse" | "villa" => RESIDENTIAL.contains(&room) || room == "lobby",
        "studio" => STUDIO.contains(&room),
        "hotel_room_suite" | "resort" => HOSPITALITY.contains(&room),
        "office" => ["lobby", "reception", "meeting_room", "open_office", "home_office"].contains(&room),
        "cafe_restaurant" => ["cafe_dining", "bar_counter", "kitchen"].contains(&room),
        "retail_showroom" => ["retail_floor", "reception"].contains(&room),
        "spa" => ["spa_treatment", "reception", "lobby"].contains(&room),
        "other" => true,
        _ => true,
    };
    if !valid {
        additive_error(field_errors, "interior.roomId", "Room is not valid for the selected building use.");
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
    fn validates_v2_color_grade_fields() {
        let mut valid = minimal();
        valid["colorGrade"] = json!({
            "schemaVersion": 1,
            "exposure": 0,
            "contrast": 0,
            "highlights": 0,
            "shadows": 0,
            "whites": 0,
            "blacks": 0,
            "temperature": 0,
            "tint": 0,
            "vibrance": 0,
            "saturation": 0,
            "clarity": 0,
            "dehaze": 0,
            "texture": -100,
            "vignette": 100,
            "grain": 100,
            "splitTone": {
                "shadowsHue": 360,
                "shadowsSat": 100,
                "highlightsHue": 0,
                "highlightsSat": 0,
                "balance": -100
            },
            "toneCurve": "matte",
            "lut": { "lutId": "example", "strength": 0 }
        });
        validate_dna(&valid).unwrap();

        for (field, value) in [("colorGrade.grain", json!(150)), ("colorGrade.splitTone.shadowsHue", json!(400))] {
            let mut invalid = valid.clone();
            if field.ends_with("grain") {
                invalid["colorGrade"]["grain"] = value;
            } else {
                invalid["colorGrade"]["splitTone"]["shadowsHue"] = value;
            }
            let error = validate_dna(&invalid).unwrap_err();
            assert!(error.details.unwrap()["fieldErrors"].get(field).is_some(), "{field}");
        }
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

    #[test]
    fn accepts_valid_interior_dna() {
        let mut dna = minimal();
        dna["interior"] = json!({
            "schemaVersion": 1,
            "buildingUseId": "office",
            "roomId": "meeting_room",
            "styleId": "modern",
            "surfaces": {
                "floor": ["polished_concrete"], "wall": ["paint"],
                "ceiling": [], "cabinetry": [], "countertop": [],
                "textile": [], "metal": ["matte_black"]
            },
            "artificialScenes": [], "furnitureIds": [], "furnishingDensity": "balanced"
        });
        validate_dna(&dna).unwrap();
    }

    #[test]
    fn accepts_valid_site_topology() {
        let mut dna = minimal();
        dna["context"]["siteTopology"] =
            json!({ "left": "attached", "right": "open", "cornerLot": true, "cornerSide": "right" });
        validate_dna(&dna).unwrap();
    }

    #[test]
    fn rejects_corner_lot_without_corner_side() {
        let mut dna = minimal();
        dna["context"]["siteTopology"] = json!({ "left": "open", "right": "open", "cornerLot": true });
        assert!(validate_dna(&dna).unwrap_err().details.unwrap()["fieldErrors"]
            .get("context.siteTopology.cornerSide")
            .is_some());
    }

    #[test]
    fn rejects_attached_corner_side() {
        let mut dna = minimal();
        dna["context"]["siteTopology"] =
            json!({ "left": "attached", "right": "open", "cornerLot": true, "cornerSide": "left" });
        assert!(validate_dna(&dna).unwrap_err().details.unwrap()["fieldErrors"]
            .get("context.siteTopology.cornerSide")
            .is_some());
    }

    #[test]
    fn rejects_non_string_corner_side_even_without_corner_lot() {
        let mut dna = minimal();
        dna["context"]["siteTopology"] = json!({
            "left": "open", "right": "open", "cornerLot": false, "cornerSide": 7
        });
        assert!(validate_dna(&dna).unwrap_err().details.unwrap()["fieldErrors"]
            .get("context.siteTopology.cornerSide")
            .is_some());
    }

    #[test]
    fn accepts_dna_without_site_topology_unchanged() {
        let dna = minimal();
        validate_dna(&dna).unwrap();
        assert!(dna["context"].get("siteTopology").is_none());
    }

    #[test]
    fn rejects_room_outside_the_building_use() {
        let mut dna = minimal();
        dna["interior"] = json!({
            "schemaVersion": 1,
            "buildingUseId": "office",
            "roomId": "bedroom",
            "styleId": "modern",
            "surfaces": {
                "floor": [], "wall": [], "ceiling": [], "cabinetry": [],
                "countertop": [], "textile": [], "metal": []
            },
            "artificialScenes": [], "furnitureIds": [], "furnishingDensity": "balanced"
        });
        let err = validate_dna(&dna).unwrap_err();
        let fields = &err.details.unwrap()["fieldErrors"];
        assert!(fields.get("interior.roomId").is_some(), "{fields}");
    }

    /// Persisted v1 DNA from before ADR-034 (no extensions); shared with the TS AC-20 test.
    pub(crate) const LEGACY_DNA: &str = include_str!("../../../tests/fixtures/nhapho-dna.json");
    /// The same DNA with `spaceCatalog`, `site` and `architecturalDetails` (ADR-034).
    pub(crate) const EXTENDED_DNA: &str =
        include_str!("../../../../../packages/domain/test-vectors/dna-v1-extensions.json");

    #[test]
    fn accepts_legacy_dna_without_extensions_unchanged() {
        let dna: Value = serde_json::from_str(LEGACY_DNA).unwrap();
        let before = dna.clone();
        validate_dna(&dna).unwrap();
        assert_eq!(dna, before);
        for key in ["spaceCatalog", "site", "architecturalDetails"] {
            assert!(dna.get(key).is_none(), "{key}");
        }
    }

    #[test]
    fn accepts_adr_034_extensions() {
        let dna: Value = serde_json::from_str(EXTENDED_DNA).unwrap();
        validate_dna(&dna).unwrap();
        assert_eq!(dna["schemaVersion"], json!(1));
        assert_eq!(dna["site"]["left"]["kind"], json!("attached_building"));
    }

    #[test]
    fn rejects_invalid_extension_values() {
        let base: Value = serde_json::from_str(EXTENDED_DNA).unwrap();
        type Mutation = fn(&mut Value);
        let cases: [(&str, Mutation); 6] = [
            ("site.version", |d| d["site"]["version"] = json!(2)),
            ("site.left.kind", |d| d["site"]["left"]["kind"] = json!("cliff")),
            ("site.coordinateConvention", |d| d["site"]["coordinateConvention"] = json!("north_up")),
            ("spaceCatalog.spaces.0.facts.widthM.evidence.status", |d| {
                d["spaceCatalog"]["spaces"][0]["facts"]["widthM"]["evidence"]["status"] = json!("guess")
            }),
            ("architecturalDetails.0.version", |d| d["architecturalDetails"][0]["version"] = json!(2)),
            ("spaceCatalog.spaces.0.facts.ceilingHeightM.evidence.confidence", |d| {
                d["spaceCatalog"]["spaces"][0]["facts"]["ceilingHeightM"]["evidence"]["confidence"] = json!(1.5)
            }),
        ];
        for (field, mutate) in cases {
            let mut dna = base.clone();
            mutate(&mut dna);
            let err = validate_dna(&dna).unwrap_err();
            let fields = err.details.unwrap()["fieldErrors"].clone();
            assert!(fields.get(field).is_some(), "{field}: {fields}");
        }
    }

    /// P0-B: the backend enforces the two TS-only refinements of `spaceCatalog`.
    #[test]
    fn enforces_unique_space_ids_and_an_existing_active_space() {
        let base: Value = serde_json::from_str(EXTENDED_DNA).unwrap();
        assert!(base["spaceCatalog"]["activeSpaceId"].is_string(), "fixture names an active space");

        // A second space that reuses the first one's id.
        let mut duplicate = base.clone();
        let copy = duplicate["spaceCatalog"]["spaces"][0].clone();
        duplicate["spaceCatalog"]["spaces"].as_array_mut().unwrap().push(copy);
        let fields = validate_dna(&duplicate).unwrap_err().details.unwrap()["fieldErrors"].clone();
        assert!(fields.get("spaceCatalog.spaces.1.id").is_some(), "{fields}");
        assert!(fields.get("spaceCatalog.spaces.0.id").is_none(), "the first occurrence is fine: {fields}");

        let mut missing = base.clone();
        missing["spaceCatalog"]["activeSpaceId"] = json!("SPC_nowhere");
        let fields = validate_dna(&missing).unwrap_err().details.unwrap()["fieldErrors"].clone();
        assert!(fields.get("spaceCatalog.activeSpaceId").is_some(), "{fields}");

        // activeSpaceId is optional; without it the catalog is valid.
        let mut no_active = base.clone();
        no_active["spaceCatalog"].as_object_mut().unwrap().remove("activeSpaceId");
        validate_dna(&no_active).unwrap();
    }

    #[test]
    fn rejects_unknown_extension_keys() {
        let mut dna: Value = serde_json::from_str(EXTENDED_DNA).unwrap();
        dna["futureExtension"] = json!({ "version": 1 });
        assert!(validate_dna(&dna).is_err());
        let mut dna: Value = serde_json::from_str(EXTENDED_DNA).unwrap();
        dna["site"]["skyline"] = json!("tall");
        assert!(validate_dna(&dna).is_err());
    }

    #[test]
    fn dna_without_interior_remains_valid_and_unchanged() {
        let dna = minimal();
        let before = dna.clone();
        validate_dna(&dna).unwrap();
        assert_eq!(dna, before);
    }
}
