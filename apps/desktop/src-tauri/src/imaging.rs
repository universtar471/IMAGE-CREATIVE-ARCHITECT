//! Image inspection and thumbnail generation for imported assets.
//! Formats are detected from file content (magic bytes), never from the extension alone.

use std::io::Cursor;
use std::path::Path;

use image::{ImageFormat, ImageReader};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult, ErrorCode};

pub const SUPPORTED_FORMATS_TEXT: &str = "JPEG (.jpg, .jpeg), PNG (.png) and WebP (.webp)";
/// Long edge of tray/hub thumbnails. Grids never load originals.
pub const THUMBNAIL_EDGE: u32 = 384;
/// Refuse absurdly large files instead of exhausting memory.
pub const MAX_IMPORT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportedFormat {
    Jpeg,
    Png,
    Webp,
}

impl SupportedFormat {
    pub fn mime(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }

    fn image_format(self) -> ImageFormat {
        match self {
            Self::Jpeg => ImageFormat::Jpeg,
            Self::Png => ImageFormat::Png,
            Self::Webp => ImageFormat::WebP,
        }
    }
}

pub fn detect_format(bytes: &[u8]) -> Option<SupportedFormat> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(SupportedFormat::Jpeg)
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(SupportedFormat::Png)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(SupportedFormat::Webp)
    } else {
        None
    }
}

#[derive(Debug, Clone)]
pub struct Inspection {
    pub format: SupportedFormat,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
    pub sha256: String,
}

/// Validate and inspect an image already read into memory.
pub fn inspect(bytes: &[u8], display_name: &str) -> AppResult<Inspection> {
    let format = detect_format(bytes).ok_or_else(|| {
        AppError::new(
            ErrorCode::UnsupportedFile,
            format!("'{display_name}' is not a supported image. Supported formats: {SUPPORTED_FORMATS_TEXT}."),
        )
    })?;
    let (width, height) =
        ImageReader::with_format(Cursor::new(bytes), format.image_format()).into_dimensions().map_err(|e| {
            AppError::new(
                ErrorCode::UnsupportedFile,
                format!(
                    "'{display_name}' looks like {} but could not be read ({e}). The file may be damaged.",
                    format.extension().to_uppercase()
                ),
            )
        })?;
    if width == 0 || height == 0 {
        return Err(AppError::new(ErrorCode::UnsupportedFile, format!("'{display_name}' has no pixels.")));
    }
    Ok(Inspection { format, width, height, size_bytes: bytes.len() as u64, sha256: hex::encode(Sha256::digest(bytes)) })
}

/// Write a small JPEG thumbnail. Failure is reported to the caller, which treats it as
/// non-fatal (the asset stays valid without a thumbnail).
pub fn write_thumbnail(bytes: &[u8], format: SupportedFormat, target: &Path) -> Result<(), String> {
    let img =
        ImageReader::with_format(Cursor::new(bytes), format.image_format()).decode().map_err(|e| e.to_string())?;
    let thumb = img.thumbnail(THUMBNAIL_EDGE, THUMBNAIL_EDGE).to_rgb8();
    thumb.save_with_format(target, ImageFormat::Jpeg).map_err(|e| e.to_string())
}
