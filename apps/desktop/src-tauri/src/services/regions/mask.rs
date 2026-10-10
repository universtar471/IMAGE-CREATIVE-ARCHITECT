use super::{BrushStroke, RegionShape};
use image::{DynamicImage, ImageBuffer, Rgba, RgbaImage};
pub fn rasterize_mask(shapes: &[RegionShape], width: u32, height: u32) -> Vec<u8> {
    let mut out = vec![0; (width * height) as usize];
    for shape in shapes {
        for y in 0..height {
            for x in 0..width {
                let px = (x as f64 + 0.5) / width as f64;
                let py = (y as f64 + 0.5) / height as f64;
                let inside = match shape {
                    RegionShape::Rect { x, y, w, h } => px >= *x && px <= x + w && py >= *y && py <= y + h,
                    RegionShape::Polygon { points } => point_in_polygon(px, py, points),
                    RegionShape::Brush { strokes } => {
                        strokes.iter().any(|s| brush_contains(s, x as f64 + 0.5, y as f64 + 0.5, width, height))
                    }
                };
                if inside {
                    out[(y * width + x) as usize] = 255;
                }
            }
        }
    }
    out
}
fn point_in_polygon(x: f64, y: f64, p: &[[f64; 2]]) -> bool {
    let mut inside = false;
    for i in 0..p.len() {
        let a = p[i];
        let b = p[(i + p.len() - 1) % p.len()];
        if ((a[1] > y) != (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0] {
            inside = !inside;
        }
    }
    inside
}
fn brush_contains(s: &BrushStroke, x: f64, y: f64, width: u32, height: u32) -> bool {
    let scale = width.max(height) as f64;
    let r = s.radius * scale;
    let point = |p: [f64; 2]| (p[0] * width as f64 - x).hypot(p[1] * height as f64 - y) <= r;
    s.points.iter().copied().any(point)
        || s.points.windows(2).any(|w| {
            let (a, b) = (w[0], w[1]);
            let ax = a[0] * width as f64;
            let ay = a[1] * height as f64;
            let bx = b[0] * width as f64;
            let by = b[1] * height as f64;
            let dx = bx - ax;
            let dy = by - ay;
            let len2 = dx * dx + dy * dy;
            let t = if len2 == 0.0 { 0.0 } else { ((x - ax) * dx + (y - ay) * dy) / len2 }.clamp(0.0, 1.0);
            let qx = ax + t * dx;
            let qy = ay + t * dy;
            (qx - x).hypot(qy - y) <= r
        })
}
pub fn feather_mask(mask: &[u8], width: u32, height: u32, radius_px: u32) -> Vec<u8> {
    if radius_px == 0 {
        return mask.to_vec();
    }
    let mut cur = mask.to_vec();
    for _ in 0..3 {
        cur = box_blur(&cur, width, height, radius_px);
    }
    cur
}

fn box_blur(input: &[u8], width: u32, height: u32, radius: u32) -> Vec<u8> {
    let mut output = vec![0; input.len()];
    for y in 0..height {
        for x in 0..width {
            let mut sum = 0_u32;
            let mut count = 0_u32;
            for delta in -(radius as i64)..=radius as i64 {
                let xx = x as i64 + delta;
                if xx < 0 || xx >= width as i64 {
                    continue;
                }
                for delta_y in -(radius as i64)..=radius as i64 {
                    let yy = y as i64 + delta_y;
                    if yy < 0 || yy >= height as i64 {
                        continue;
                    }
                    sum += u32::from(input[(yy as u32 * width + xx as u32) as usize]);
                    count += 1;
                }
            }
            output[(y * width + x) as usize] = ((sum * 2 + count) / (2 * count)) as u8;
        }
    }
    output
}
pub fn png_mask(mask: &[u8], width: u32, height: u32, alpha_zero: bool) -> Result<Vec<u8>, image::ImageError> {
    let mut img: RgbaImage = ImageBuffer::new(width, height);
    for (i, p) in img.pixels_mut().enumerate() {
        let v = mask[i];
        *p = if alpha_zero { Rgba([255, 255, 255, 255 - v]) } else { Rgba([v, v, v, 255]) };
    }
    let mut b = Vec::new();
    DynamicImage::ImageRgba8(img).write_to(&mut std::io::Cursor::new(&mut b), image::ImageFormat::Png)?;
    Ok(b)
}
pub fn composite(
    source: &DynamicImage,
    generated: &DynamicImage,
    mask: &[u8],
    width: u32,
    height: u32,
) -> DynamicImage {
    let src = source.to_rgba8();
    let gen = generated.resize_exact(width, height, image::imageops::FilterType::Lanczos3).to_rgba8();
    let mut out = src.clone();
    for y in 0..height {
        for x in 0..width {
            let a = mask[(y * width + x) as usize] as f32 / 255.0;
            let s = src.get_pixel(x, y);
            let g = gen.get_pixel(x, y);
            let p = out.get_pixel_mut(x, y);
            for c in 0..3 {
                p[c] = ((s[c] as f32) * (1.0 - a) + (g[c] as f32) * a).round() as u8;
            }
            p[3] = s[3];
        }
    }
    DynamicImage::ImageRgba8(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vector {
        name: String,
        width: u32,
        height: u32,
        shapes: Vec<RegionShape>,
        mask: Vec<u8>,
        feather: Option<Feather>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Feather {
        radius_px: u32,
        output: Vec<u8>,
    }

    #[test]
    fn matches_domain_mask_vectors() {
        let vectors: Vec<Vector> =
            serde_json::from_str(include_str!("../../../../../../packages/domain/test-vectors/masks.json"))
                .expect("domain mask vectors must be valid JSON");
        assert!(!vectors.is_empty());
        for vector in vectors {
            let actual = rasterize_mask(&vector.shapes, vector.width, vector.height);
            assert_eq!(actual, vector.mask, "mask vector {}", vector.name);
            if let Some(feather) = vector.feather {
                let actual = feather_mask(&actual, vector.width, vector.height, feather.radius_px);
                assert_eq!(actual.len(), feather.output.len(), "feather vector {}", vector.name);
                for (index, (actual, expected)) in actual.iter().zip(&feather.output).enumerate() {
                    assert!(
                        actual.abs_diff(*expected) <= 1,
                        "feather vector {} differs at {index}: expected {expected}, got {actual}",
                        vector.name
                    );
                }
            }
        }
    }
}
