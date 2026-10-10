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
    let mut cur: Vec<f32> = mask.iter().map(|v| *v as f32).collect();
    for _ in 0..3 {
        let mut next = vec![0.0; cur.len()];
        for y in 0..height {
            for x in 0..width {
                let mut sum = 0.0;
                let mut n = 0.0;
                let r = radius_px as i32;
                for yy in (y as i32 - r).max(0)..=(y as i32 + r).min(height as i32 - 1) {
                    for xx in (x as i32 - r).max(0)..=(x as i32 + r).min(width as i32 - 1) {
                        sum += cur[(yy as u32 * width + xx as u32) as usize];
                        n += 1.0;
                    }
                }
                next[(y * width + x) as usize] = sum / n;
            }
        }
        cur = next;
    }
    cur.into_iter().map(|v| v.round().clamp(0.0, 255.0) as u8).collect()
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
    #[test]
    fn rectangle_and_union() {
        let m = rasterize_mask(&[RegionShape::Rect { x: 0.0, y: 0.0, w: 0.5, h: 1.0 }], 4, 2);
        assert_eq!(m, [255, 255, 0, 0, 255, 255, 0, 0]);
    }
    #[test]
    fn feather_changes_edges() {
        let f = feather_mask(&[255, 255, 0, 0], 4, 1, 1);
        assert!(f[0] < 255 && f[1] > f[2]);
    }
}
