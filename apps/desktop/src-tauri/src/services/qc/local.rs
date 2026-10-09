use image::{DynamicImage, GrayImage, ImageBuffer, Luma};

/// Sobel magnitude threshold. Keeping this explicit makes the metric deterministic across
/// platforms and avoids treating compression noise as architectural edges.
const SOBEL_THRESHOLD: i32 = 80;

pub fn resize_long_edge(image: &DynamicImage, edge: u32) -> DynamicImage {
    let longest = image.width().max(image.height());
    let scale = edge as f32 / longest as f32;
    let width = (image.width() as f32 * scale).round().max(1.0) as u32;
    let height = (image.height() as f32 * scale).round().max(1.0) as u32;
    image.resize_exact(width, height, image::imageops::FilterType::Lanczos3)
}

fn edges(image: &DynamicImage) -> GrayImage {
    let gray = image.to_luma8();
    let (w, h) = gray.dimensions();
    let mut out = ImageBuffer::from_pixel(w, h, Luma([0]));
    if w < 3 || h < 3 {
        return out;
    }
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let p = |dx: i32, dy: i32| gray.get_pixel((x as i32 + dx) as u32, (y as i32 + dy) as u32)[0] as i32;
            let gx = -p(-1, -1) + p(1, -1) - 2 * p(-1, 0) + 2 * p(1, 0) - p(-1, 1) + p(1, 1);
            let gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
            let magnitude = (gx.abs() + gy.abs()) / 2;
            if magnitude >= SOBEL_THRESHOLD {
                out.put_pixel(x, y, Luma([255]));
            }
        }
    }
    out
}

fn dilate(image: &GrayImage) -> GrayImage {
    let (w, h) = image.dimensions();
    let mut out = ImageBuffer::from_pixel(w, h, Luma([0]));
    for y in 0..h {
        for x in 0..w {
            let on = (-2..=2).any(|dy| {
                (-2..=2).any(|dx| {
                    let xx = x as i32 + dx;
                    let yy = y as i32 + dy;
                    xx >= 0 && yy >= 0 && xx < w as i32 && yy < h as i32 && image.get_pixel(xx as u32, yy as u32)[0] > 0
                })
            });
            if on {
                out.put_pixel(x, y, Luma([255]));
            }
        }
    }
    out
}

fn iou(a: &GrayImage, b: &GrayImage) -> f32 {
    let mut intersection = 0u64;
    let mut union = 0u64;
    for (pa, pb) in a.pixels().zip(b.pixels()) {
        let aa = pa[0] > 0;
        let bb = pb[0] > 0;
        intersection += u64::from(aa && bb);
        union += u64::from(aa || bb);
    }
    if union == 0 {
        0.0
    } else {
        intersection as f32 / union as f32
    }
}

fn laplacian_variance(image: &DynamicImage) -> f32 {
    let gray = image.to_luma8();
    let (w, h) = gray.dimensions();
    if w < 3 || h < 3 {
        return 0.0;
    }
    let mut values = Vec::with_capacity((w * h) as usize);
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let c = gray.get_pixel(x, y)[0] as f32;
            let n = gray.get_pixel(x, y - 1)[0] as f32;
            let s = gray.get_pixel(x, y + 1)[0] as f32;
            let e = gray.get_pixel(x + 1, y)[0] as f32;
            let wv = gray.get_pixel(x - 1, y)[0] as f32;
            values.push(n + s + e + wv - 4.0 * c);
        }
    }
    let mean = values.iter().sum::<f32>() / values.len() as f32;
    values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / values.len() as f32
}

pub fn clipped_pct(image: &DynamicImage) -> f32 {
    let rgba = image.to_rgba8();
    let total = rgba.width() as f32 * rgba.height() as f32;
    if total == 0.0 {
        return 0.0;
    }
    let clipped = rgba.pixels().filter(|p| p.0[..3].iter().any(|v| *v == 0 || *v == 255)).count() as f32;
    clipped * 100.0 / total
}

pub fn edge_alignment(output: &DynamicImage, reference: &DynamicImage) -> f32 {
    let output = resize_long_edge(output, 512);
    let reference = reference.resize_exact(output.width(), output.height(), image::imageops::FilterType::Lanczos3);
    let a = dilate(&edges(&output));
    let b = dilate(&edges(&reference));
    iou(&a, &b) * 100.0
}

pub fn sharpness(image: &DynamicImage) -> f32 {
    (laplacian_variance(&resize_long_edge(image, 512)) / 4.0).min(100.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn checker(offset: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(96, 96, |x, y| {
            let v = if ((x + offset) / 8 + y / 8).is_multiple_of(2) { 255 } else { 0 };
            Rgb([v, v, v])
        }))
    }

    #[test]
    fn identical_images_are_about_one_hundred() {
        assert!(edge_alignment(&checker(0), &checker(0)) > 99.0);
    }

    #[test]
    fn shifted_images_are_lower() {
        assert!(edge_alignment(&checker(3), &checker(0)) < 99.0);
    }

    #[test]
    fn blank_image_has_low_sharpness() {
        let blank = DynamicImage::ImageRgb8(RgbImage::from_pixel(32, 32, Rgb([120, 120, 120])));
        assert!(sharpness(&blank) < 1.0);
    }

    #[test]
    fn clipping_is_reported_as_percentage() {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(2, 2, Rgb([0, 128, 255])));
        assert!((clipped_pct(&image) - 100.0).abs() < 0.01);
    }
}
