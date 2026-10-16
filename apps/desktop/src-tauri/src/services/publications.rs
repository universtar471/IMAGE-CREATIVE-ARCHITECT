//! Publishing Studio storage, optional AI captions and export files (SRS P5b, ADR-038).
//!
//! A publication document (`{ publication, facts }`) is planned and edited in the webview
//! with the Zod domain; this module is the persistence gate. Every save is checked against
//! the JSON Schema exported from `PublicationDocumentSchema`
//! (`packages/domain/schema/publication-document.schema.json`), so invalid JSON never reaches
//! SQLite. Export files are rendered in the webview; the backend only writes the bytes it is
//! given to a place the user picked in a native dialog, after checking the file signature.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult, ErrorCode};
use crate::repositories;
use crate::services::provider_settings::{find_provider, key_for, not_configured};
use crate::services::{ensure_not_archived, AppCore};
use crate::util::{new_id, prefix};

const SCHEMA_TEXT: &str = include_str!("../../../../../packages/domain/schema/publication-document.schema.json");

/// Largest stored document. A 100-page book with long captions stays far below this.
pub const MAX_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;
/// Longest caption prompt accepted (`buildCaptionPrompt` output).
pub const MAX_CAPTION_PROMPT_CHARS: usize = 40_000;
/// Most files one export may write (one per page).
pub const MAX_EXPORT_FILES: usize = 500;
/// Largest single export file (a PDF of many A3 pages).
pub const MAX_EXPORT_FILE_BYTES: usize = 512 * 1024 * 1024;

/// System message of the optional caption call. The SRS §11.4 editorial prompt itself is
/// the user message, built by `buildCaptionPrompt` in the domain.
pub const CAPTION_SYSTEM_PROMPT: &str = "You write captions for an architectural publication. Follow the \
instructions in the user message exactly. Answer with the requested JSON only: no preamble, no markdown.";

fn validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let schema: Value = serde_json::from_str(SCHEMA_TEXT).expect("embedded publication schema is valid JSON");
        jsonschema::validator_for(&schema).expect("embedded publication schema compiles")
    })
}

/// Validates a publication document. Field errors are keyed by dotted path
/// (`publication.pages.0.slots.1.rect`), like the DNA validator.
pub fn validate_document(document: &Value) -> AppResult<()> {
    let mut field_errors = serde_json::Map::new();
    for err in validator().iter_errors(document) {
        let pointer = err.instance_path().to_string();
        let key = pointer.trim_start_matches('/').replace('/', ".");
        let key = if key.is_empty() { "(root)".to_string() } else { key };
        field_errors.entry(key).or_insert_with(|| Value::String(err.to_string()));
    }
    if let Some(pages) = document.pointer("/publication/pages").and_then(Value::as_array) {
        if pages.is_empty() {
            field_errors
                .insert("publication.pages".into(), Value::String("A publication needs at least one page.".into()));
        }
    }
    if field_errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::validation("The publication has invalid values and was not saved.")
            .with_details(json!({ "fieldErrors": field_errors })))
    }
}

/// Mirrors `PublicationRecordDTOSchema`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationRecordDto {
    pub id: String,
    pub project_id: String,
    pub publication: Value,
    pub facts: Value,
    pub created_at: String,
    pub updated_at: String,
}

/// Mirrors `PublicationSummaryDTOSchema`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationSummaryDto {
    pub id: String,
    pub project_id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub publication_type: String,
    pub paper: String,
    pub target_page_count: u64,
    pub created_at: String,
    pub updated_at: String,
}

/// Mirrors `PublicationSaveRequestSchema`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub project_id: String,
    pub publication_id: Option<String>,
    pub publication: Value,
    #[serde(default = "empty_array")]
    pub facts: Value,
}

fn empty_array() -> Value {
    Value::Array(Vec::new())
}

type Row = (String, String, String, String, String);

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
}

fn parse_json(id: &str, text: &str) -> AppResult<Value> {
    serde_json::from_str(text)
        .map_err(|e| AppError::new(ErrorCode::DbError, format!("Stored publication '{id}' is not valid JSON: {e}")))
}

fn record((id, project_id, json, created_at, updated_at): Row) -> AppResult<PublicationRecordDto> {
    let document = parse_json(&id, &json)?;
    Ok(PublicationRecordDto {
        publication: document.get("publication").cloned().unwrap_or(Value::Null),
        facts: document.get("facts").cloned().unwrap_or_else(empty_array),
        id,
        project_id,
        created_at,
        updated_at,
    })
}

fn summary((id, project_id, json, created_at, updated_at): Row) -> AppResult<PublicationSummaryDto> {
    let document = parse_json(&id, &json)?;
    let field = |name: &str| document.pointer(&format!("/publication/{name}")).cloned().unwrap_or(Value::Null);
    Ok(PublicationSummaryDto {
        title: field("title").as_str().unwrap_or_default().to_string(),
        publication_type: field("type").as_str().unwrap_or_default().to_string(),
        paper: field("paper").as_str().unwrap_or_default().to_string(),
        target_page_count: field("targetPageCount").as_u64().unwrap_or(1),
        id,
        project_id,
        created_at,
        updated_at,
    })
}

const COLUMNS: &str = "id, project_id, json, created_at, updated_at";

pub fn list(core: &AppCore, project_id: &str) -> AppResult<Vec<PublicationSummaryDto>> {
    let conn = core.conn()?;
    repositories::get_project(&conn, project_id)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM publications WHERE project_id = ?1 ORDER BY updated_at DESC, rowid DESC"
    ))?;
    let rows = stmt.query_map([project_id], read_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(summary).collect()
}

fn find(conn: &rusqlite::Connection, project_id: &str, publication_id: &str) -> AppResult<Row> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM publications WHERE id = ?1 AND project_id = ?2"),
        [publication_id, project_id],
        read_row,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::not_found("Publication", publication_id),
        other => other.into(),
    })
}

pub fn get(core: &AppCore, project_id: &str, publication_id: &str) -> AppResult<PublicationRecordDto> {
    let conn = core.conn()?;
    repositories::get_project(&conn, project_id)?;
    record(find(&conn, project_id, publication_id)?)
}

pub fn save(core: &AppCore, request: SaveRequest) -> AppResult<PublicationRecordDto> {
    let document = json!({ "publication": request.publication, "facts": request.facts });
    validate_document(&document)?;
    let text = document.to_string();
    if text.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::validation(format!(
            "The publication is larger than {} MB and was not saved.",
            MAX_DOCUMENT_BYTES / (1024 * 1024)
        )));
    }
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repositories::get_project(&tx, &request.project_id)?;
    ensure_not_archived(&project)?;
    let now = core.now_iso();
    let id = match request.publication_id {
        Some(id) => {
            let updated = tx.execute(
                "UPDATE publications SET json = ?1, updated_at = ?2 WHERE id = ?3 AND project_id = ?4",
                rusqlite::params![text, now, id, request.project_id],
            )?;
            if updated == 0 {
                return Err(AppError::not_found("Publication", &id));
            }
            id
        }
        None => {
            let id = new_id(prefix::PUBLICATION);
            tx.execute(
                "INSERT INTO publications (id, project_id, json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                rusqlite::params![id, request.project_id, text, now],
            )?;
            id
        }
    };
    let saved = record(find(&tx, &request.project_id, &id)?)?;
    tx.commit()?;
    Ok(saved)
}

pub fn delete(core: &AppCore, project_id: &str, publication_id: &str) -> AppResult<()> {
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repositories::get_project(&tx, project_id)?;
    ensure_not_archived(&project)?;
    let removed = tx.execute(
        "DELETE FROM publications WHERE id = ?1 AND project_id = ?2",
        rusqlite::params![publication_id, project_id],
    )?;
    if removed == 0 {
        return Err(AppError::not_found("Publication", publication_id));
    }
    tx.commit()?;
    Ok(())
}

// ------------------------------------------------------------------ AI captions

/// Mirrors the bridge request of `publication_caption_draft`. No `Debug`: user content.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionDraftRequest {
    pub project_id: String,
    pub provider_id: String,
    pub prompt: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptionDraftResult {
    /// The provider's answer, unparsed; the webview parses it with `CaptionDraftResponseSchema`
    /// and marks every drafted sentence `needs_review`.
    pub raw: String,
}

/// One paid chat call, only on an explicit click in the UI. Nothing is stored here.
pub fn caption_draft(core: &AppCore, request: CaptionDraftRequest) -> AppResult<CaptionDraftResult> {
    {
        let conn = core.conn()?;
        let project = repositories::get_project(&conn, &request.project_id)?;
        ensure_not_archived(&project)?;
    }
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::validation("The caption prompt is empty."));
    }
    if prompt.chars().count() > MAX_CAPTION_PROMPT_CHARS {
        return Err(AppError::validation(format!(
            "The caption prompt is longer than {MAX_CAPTION_PROMPT_CHARS} characters."
        )));
    }
    let provider = find_provider(core, &request.provider_id)?;
    let info = provider.info();
    if provider.chat_model().is_none() {
        return Err(AppError::validation(format!("{} does not offer text generation.", info.label)));
    }
    let key = key_for(core, provider.as_ref());
    if provider.config_problem().is_some() || (info.requires_api_key && key.is_none()) {
        return Err(not_configured(provider.as_ref()));
    }
    let api_key = key.as_ref().map(|k| k.value.as_str());
    match provider.chat(CAPTION_SYSTEM_PROMPT, prompt, api_key) {
        Ok(raw) => Ok(CaptionDraftResult { raw }),
        Err(e) => Err(AppError::new(ErrorCode::ProviderError, e.message).with_details(json!({
            "providerId": info.id,
            "kind": e.kind.as_str(),
            "retryable": e.kind.retryable(),
        }))),
    }
}

// ------------------------------------------------------------------ export files

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Pdf,
    Png,
    Jpeg,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Pdf => "pdf",
            ExportFormat::Png => "png",
            ExportFormat::Jpeg => "jpg",
        }
    }

    fn signature_ok(self, bytes: &[u8]) -> bool {
        match self {
            ExportFormat::Pdf => bytes.starts_with(b"%PDF-"),
            ExportFormat::Png => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
            ExportFormat::Jpeg => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        }
    }
}

/// Mirrors the bridge request of `publication_export_save`. Files are base64 strings.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaveRequest {
    pub project_id: String,
    pub format: ExportFormat,
    /// Suggested file name without extension (the publication title).
    pub base_name: String,
    pub files: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaveResult {
    /// False when the user closed the dialog; nothing was written.
    pub saved: bool,
    pub paths: Vec<String>,
}

/// Where an export goes: one PDF file, or a folder for per-page images.
#[derive(Debug, Clone, PartialEq)]
pub enum ExportTarget {
    File(PathBuf),
    Folder(PathBuf),
}

/// A file name the OS accepts: no separators or reserved characters, never empty.
pub fn safe_base_name(name: &str) -> String {
    let cleaned: String =
        name.chars().map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c }).collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let short: String = trimmed.chars().take(80).collect();
    if short.is_empty() {
        "publication".into()
    } else {
        short
    }
}

/// Decodes and checks every file before anything is written.
pub fn decode_export_files(format: ExportFormat, files: &[String]) -> AppResult<Vec<Vec<u8>>> {
    if files.is_empty() {
        return Err(AppError::validation("There is nothing to export."));
    }
    if files.len() > MAX_EXPORT_FILES {
        return Err(AppError::validation(format!("An export can write at most {MAX_EXPORT_FILES} files.")));
    }
    if format == ExportFormat::Pdf && files.len() != 1 {
        return Err(AppError::validation("A PDF export is one file."));
    }
    files
        .iter()
        .enumerate()
        .map(|(index, text)| {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(text.as_bytes())
                .map_err(|e| AppError::validation(format!("Export file {} is not valid base64: {e}", index + 1)))?;
            if bytes.len() > MAX_EXPORT_FILE_BYTES {
                return Err(AppError::validation(format!("Export file {} is too large.", index + 1)));
            }
            if !format.signature_ok(&bytes) {
                return Err(AppError::validation(format!(
                    "Export file {} is not a {} file.",
                    index + 1,
                    format.extension().to_uppercase()
                )));
            }
            Ok(bytes)
        })
        .collect()
}

/// A path in `folder` for `name.ext` that does not exist yet (`name (2).ext`, …).
fn free_path(folder: &Path, name: &str, extension: &str) -> PathBuf {
    let first = folder.join(format!("{name}.{extension}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| folder.join(format!("{name} ({n}).{extension}")))
        .find(|path| !path.exists())
        .expect("an unused file name exists")
}

/// Writes checked export files. A PDF goes to the chosen file (the save dialog already
/// confirmed any overwrite); page images go into the chosen folder as `<base>-p01.png`, …,
/// never replacing an existing file.
pub fn write_export(
    target: &ExportTarget,
    format: ExportFormat,
    base_name: &str,
    files: &[Vec<u8>],
) -> AppResult<Vec<String>> {
    let write = |path: &Path, bytes: &[u8]| -> AppResult<String> {
        std::fs::write(path, bytes).map_err(|e| AppError::io("Cannot write the export file", e))?;
        Ok(path.to_string_lossy().into_owned())
    };
    match target {
        ExportTarget::File(path) => {
            let mut path = path.clone();
            if path.extension().is_none() {
                path.set_extension(format.extension());
            }
            Ok(vec![write(&path, &files[0])?])
        }
        ExportTarget::Folder(folder) => {
            if !folder.is_dir() {
                return Err(AppError::validation("The export folder does not exist."));
            }
            let base = safe_base_name(base_name);
            let digits = files.len().to_string().len().max(2);
            files
                .iter()
                .enumerate()
                .map(|(index, bytes)| {
                    let name = format!("{base}-p{:0digits$}", index + 1);
                    write(&free_path(folder, &name, format.extension()), bytes)
                })
                .collect()
        }
    }
}

/// Checks the request before the save dialog opens (unknown or archived project, bad files).
pub fn prepare_export(core: &AppCore, request: &ExportSaveRequest) -> AppResult<Vec<Vec<u8>>> {
    {
        let conn = core.conn()?;
        repositories::get_project(&conn, &request.project_id)?;
    }
    decode_export_files(request.format, &request.files)
}

/// A planned two-page Portfolio document from the domain (`planPublication`).
#[cfg(test)]
pub(crate) const TEST_VECTOR: &str =
    include_str!("../../../../../packages/domain/test-vectors/publication-document.json");

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ProviderErrorKind;
    use crate::services::projects;
    use crate::services::provider_settings;
    use crate::services::tests_support::{core, core_with_double, test_create_villa, TestBehavior, TEST_PROVIDER};

    fn document() -> Value {
        serde_json::from_str(TEST_VECTOR).unwrap()
    }

    fn save_request(project_id: &str, id: Option<String>, document: &Value) -> SaveRequest {
        SaveRequest {
            project_id: project_id.into(),
            publication_id: id,
            publication: document["publication"].clone(),
            facts: document["facts"].clone(),
        }
    }

    #[test]
    fn the_domain_test_vector_is_a_valid_document() {
        validate_document(&document()).unwrap();
    }

    #[test]
    fn save_get_list_delete_roundtrip() {
        let (_tmp, core) = core();
        let p = test_create_villa(&core, "Villa");
        let doc = document();
        let created = save(&core, save_request(&p.id, None, &doc)).unwrap();
        assert!(created.id.starts_with("PUB_"));
        assert_eq!(created.publication, doc["publication"]);
        assert_eq!(created.facts, doc["facts"]);
        assert_eq!(get(&core, &p.id, &created.id).unwrap(), created);

        let mut edited = doc.clone();
        edited["publication"]["title"] = json!("Villa — bản 2");
        let updated = save(&core, save_request(&p.id, Some(created.id.clone()), &edited)).unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(updated.publication["title"], "Villa — bản 2");

        let second = save(&core, save_request(&p.id, None, &doc)).unwrap();
        let rows = list(&core, &p.id).unwrap();
        assert_eq!(rows.len(), 2);
        let row = rows.iter().find(|r| r.id == created.id).unwrap();
        assert_eq!(
            (row.title.as_str(), row.publication_type.as_str(), row.paper.as_str(), row.target_page_count),
            ("Villa — bản 2", "portfolio", "A4", 2)
        );

        delete(&core, &p.id, &second.id).unwrap();
        assert_eq!(list(&core, &p.id).unwrap().len(), 1);
        assert_eq!(get(&core, &p.id, &second.id).unwrap_err().code, ErrorCode::NotFound);
        assert_eq!(delete(&core, &p.id, &second.id).unwrap_err().code, ErrorCode::NotFound);
    }

    #[test]
    fn invalid_documents_never_reach_the_database() {
        let (_tmp, core) = core();
        let p = test_create_villa(&core, "Villa");
        let mut bad = document();
        bad["publication"]["targetPageCount"] = json!(0);
        bad["publication"]["pages"][0]["slots"][0]["rect"]["w"] = json!(2);
        bad["facts"][0]["status"] = json!("rumour");
        let err = save(&core, save_request(&p.id, None, &bad)).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
        let fields = err.details.unwrap()["fieldErrors"].as_object().unwrap().clone();
        assert!(fields.contains_key("publication.targetPageCount"), "{fields:?}");
        assert!(fields.contains_key("publication.pages.0.slots.0"), "{fields:?}");
        assert!(fields.contains_key("facts.0.status"), "{fields:?}");

        let mut empty = document();
        empty["publication"]["pages"] = json!([]);
        assert_eq!(save(&core, save_request(&p.id, None, &empty)).unwrap_err().code, ErrorCode::ValidationError);
        let mut extra = document();
        extra["publication"]["rogue"] = json!(true);
        assert_eq!(save(&core, save_request(&p.id, None, &extra)).unwrap_err().code, ErrorCode::ValidationError);
        assert!(list(&core, &p.id).unwrap().is_empty());
    }

    #[test]
    fn records_belong_to_their_project_and_archived_projects_are_read_only() {
        let (_tmp, core) = core();
        let a = test_create_villa(&core, "A");
        let b = test_create_villa(&core, "B");
        let saved = save(&core, save_request(&a.id, None, &document())).unwrap();
        assert_eq!(get(&core, &b.id, &saved.id).unwrap_err().code, ErrorCode::NotFound);
        assert_eq!(
            save(&core, save_request(&b.id, Some(saved.id.clone()), &document())).unwrap_err().code,
            ErrorCode::NotFound
        );
        assert_eq!(delete(&core, &b.id, &saved.id).unwrap_err().code, ErrorCode::NotFound);

        projects::set_archived(&core, &a.id, true).unwrap();
        assert_eq!(list(&core, &a.id).unwrap().len(), 1, "archived projects stay readable");
        assert_eq!(save(&core, save_request(&a.id, None, &document())).unwrap_err().code, ErrorCode::InvalidState);
        assert_eq!(delete(&core, &a.id, &saved.id).unwrap_err().code, ErrorCode::InvalidState);
    }

    #[test]
    fn deleting_a_project_deletes_its_publications() {
        let (_tmp, core) = core();
        let p = test_create_villa(&core, "Villa");
        save(&core, save_request(&p.id, None, &document())).unwrap();
        let conn = core.conn().unwrap();
        conn.execute("DELETE FROM projects WHERE id = ?1", [&p.id]).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM publications", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn caption_draft_goes_through_the_chat_provider_only_when_configured() {
        let (_tmp, core, double) = core_with_double();
        let p = test_create_villa(&core, "Villa");
        let request = |provider: &str, prompt: &str| CaptionDraftRequest {
            project_id: p.id.clone(),
            provider_id: provider.into(),
            prompt: prompt.into(),
        };
        assert_eq!(
            caption_draft(&core, request(TEST_PROVIDER, "p")).unwrap_err().code,
            ErrorCode::ProviderNotConfigured
        );
        assert_eq!(caption_draft(&core, request(TEST_PROVIDER, "  ")).unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(
            caption_draft(&core, request(crate::providers::local_preview::ID, "p")).unwrap_err().code,
            ErrorCode::ValidationError
        );
        assert!(double.last_chat.lock().unwrap().is_none(), "no call before the checks pass");

        provider_settings::set_api_key(&core, TEST_PROVIDER, "chat-key").unwrap();
        let out = caption_draft(&core, request(TEST_PROVIDER, "Write captions\nslot P1")).unwrap();
        assert_eq!(out.raw, "Enhanced: slot P1");
        let (system, user, key) = double.last_chat.lock().unwrap().clone().unwrap();
        assert_eq!(
            (system.as_str(), user.as_str(), key.as_deref()),
            (CAPTION_SYSTEM_PROMPT, "Write captions\nslot P1", Some("chat-key"))
        );

        double.set_behavior(TestBehavior::Fail(ProviderErrorKind::RateLimited));
        let err = caption_draft(&core, request(TEST_PROVIDER, "p")).unwrap_err();
        assert_eq!(err.code, ErrorCode::ProviderError);
        assert_eq!(err.details.unwrap()["kind"], "rate_limited");
    }

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn export_files_are_checked_before_writing() {
        let pdf = b64(b"%PDF-1.4\n%%EOF\n");
        let png = b64(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]);
        let jpeg = b64(&[0xFF, 0xD8, 0xFF, 0xE0, 0]);
        assert!(decode_export_files(ExportFormat::Pdf, std::slice::from_ref(&pdf)).is_ok());
        assert!(decode_export_files(ExportFormat::Png, &[png.clone(), png.clone()]).is_ok());
        assert!(decode_export_files(ExportFormat::Jpeg, std::slice::from_ref(&jpeg)).is_ok());
        let code = |format, files: &[String]| decode_export_files(format, files).unwrap_err().code;
        assert_eq!(code(ExportFormat::Pdf, &[]), ErrorCode::ValidationError);
        assert_eq!(code(ExportFormat::Pdf, &[pdf.clone(), pdf.clone()]), ErrorCode::ValidationError);
        assert_eq!(code(ExportFormat::Png, std::slice::from_ref(&jpeg)), ErrorCode::ValidationError);
        assert_eq!(code(ExportFormat::Jpeg, &["not base64!".into()]), ErrorCode::ValidationError);
    }

    #[test]
    fn export_writes_one_pdf_or_numbered_page_images_without_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let pdf = ExportTarget::File(tmp.path().join("book"));
        let written = write_export(&pdf, ExportFormat::Pdf, "x", &[b"%PDF-1.4".to_vec()]).unwrap();
        assert_eq!(written, [tmp.path().join("book.pdf").to_string_lossy()]);

        let folder = ExportTarget::Folder(tmp.path().to_path_buf());
        let pages = vec![vec![1u8], vec![2u8]];
        let first = write_export(&folder, ExportFormat::Png, "Villa: A/B", &pages).unwrap();
        let names: Vec<_> =
            first.iter().map(|p| Path::new(p).file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["Villa_ A_B-p01.png", "Villa_ A_B-p02.png"]);
        let again = write_export(&folder, ExportFormat::Png, "Villa: A/B", &pages).unwrap();
        assert!(again[0].ends_with("Villa_ A_B-p01 (2).png"), "{again:?}");
        assert_eq!(std::fs::read(&first[0]).unwrap(), [1u8]);
        assert_eq!(safe_base_name("  ..  "), "publication");
    }
}
