//! Download of `data[].url` images (gateways that ignore `response_format: b64_json`).
//!
//! The URL comes from the vendor, so it is treated with care: https only (plain http only for a
//! loopback host, used by tests), no API key sent (it may point at a third-party file host), a
//! size cap and the generate timeout. Messages never echo the URL (it may carry a signed token).

use std::io::Read;
use std::time::Duration;

use super::super::{ProviderError, ProviderErrorKind, ProviderImage};

/// Largest image accepted from a download (a 4K PNG is well below this).
pub const MAX_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;

fn bad(vendor: &str, what: &str) -> ProviderError {
    ProviderError::new(ProviderErrorKind::BadResponse, format!("{vendor} returned an image link that {what}."))
}

/// `https://…`, or `http://` to a loopback host.
pub fn allowed(url: &reqwest::Url) -> bool {
    match url.scheme() {
        "https" => url.host_str().is_some(),
        "http" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
        _ => false,
    }
}

/// The image type from the `Content-Type` header, else from the file's magic bytes.
fn mime_type(content_type: Option<&str>, bytes: &[u8]) -> Option<&'static str> {
    let declared = content_type.unwrap_or_default().split(';').next().unwrap_or_default().trim();
    match declared {
        "image/png" => return Some("image/png"),
        "image/jpeg" | "image/jpg" => return Some("image/jpeg"),
        "image/webp" => return Some("image/webp"),
        _ => {}
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

pub fn fetch(vendor: &str, url: &str, timeout: Duration) -> Result<ProviderImage, ProviderError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| bad(vendor, "is not a valid URL"))?;
    if !allowed(&parsed) {
        return Err(bad(vendor, "is not https"));
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| ProviderError::new(ProviderErrorKind::Network, "Could not initialise the HTTPS client."))?;
    let response = client.get(parsed).send().map_err(|e| {
        if e.is_timeout() {
            ProviderError::new(
                ProviderErrorKind::Timeout,
                format!("Downloading the image from {vendor} took longer than {} s.", timeout.as_secs()),
            )
        } else {
            ProviderError::new(ProviderErrorKind::Network, format!("Could not download the image {vendor} linked to."))
        }
    })?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(ProviderError::new(
            ProviderErrorKind::BadResponse,
            format!("Downloading the image {vendor} linked to failed (HTTP {status})."),
        ));
    }
    if response.content_length().is_some_and(|n| n > MAX_DOWNLOAD_BYTES) {
        return Err(bad(vendor, "points to a file larger than 50 MB"));
    }
    let content_type =
        response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let mut bytes = Vec::new();
    response.take(MAX_DOWNLOAD_BYTES + 1).read_to_end(&mut bytes).map_err(|_| {
        ProviderError::new(ProviderErrorKind::Network, format!("Downloading the image from {vendor} was cut off."))
    })?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(bad(vendor, "points to a file larger than 50 MB"));
    }
    let mime =
        mime_type(content_type.as_deref(), &bytes).ok_or_else(|| bad(vendor, "is not a PNG, JPEG or WebP image"))?;
    Ok(ProviderImage { mime_type: mime.to_string(), bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_or_loopback_http_is_allowed() {
        let ok = |u: &str| allowed(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://cdn.example.com/a.png"));
        assert!(ok("http://127.0.0.1:8080/a.png"));
        assert!(ok("http://localhost/a.png"));
        assert!(!ok("http://cdn.example.com/a.png"));
        assert!(!ok("file:///C:/secret.png"));
        assert!(!ok("ftp://example.com/a.png"));
    }

    #[test]
    fn mime_comes_from_header_or_magic_bytes() {
        assert_eq!(mime_type(Some("image/jpeg; charset=binary"), b""), Some("image/jpeg"));
        assert_eq!(mime_type(Some("application/octet-stream"), b"\x89PNG\r\n\x1a\nxx"), Some("image/png"));
        assert_eq!(mime_type(None, b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(mime_type(Some("text/html"), b"<html>"), None);
    }
}
