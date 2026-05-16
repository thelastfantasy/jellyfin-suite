use image::{Rgba, RgbaImage};
use qrcode::{EcLevel, QrCode};

const QR_URL: &str = "https://github.com/thelastfantasy/jellyfin-recents";
const MODULE_PX: u32 = 3;
const QUIET: u32 = 2;
const BUBBLE_PAD: u32 = 6;
const QR_MARGIN: u32 = 10;
const BUBBLE_RADIUS: u32 = 10;

/// Returns the pixel width of the QR strip appended to the right of the canvas.
/// Pre-computed for version-5 QR (37×37 modules, M ECC) which fits the URL.
pub fn qr_strip_width() -> u32 {
    let qr_px = (37 + QUIET * 2) * MODULE_PX; // 123px
    QR_MARGIN + qr_px + BUBBLE_PAD * 2 + QR_MARGIN
}

/// Render the QR bubble into an already-allocated strip at x=[strip_x, strip_x+strip_w).
/// All colours come directly from the theme; no runtime heuristics needed.
pub fn render_qr_in_strip(
    img: &mut RgbaImage,
    strip_x: u32,
    _strip_w: u32,
    header_h: u32,
    theme: &crate::text_renderer::ThemeColors,
) {
    let img_w = img.width();

    let code = match QrCode::with_error_correction_level(QR_URL.as_bytes(), EcLevel::M) {
        Ok(c) => c,
        Err(_) => return,
    };

    let module_count = code.width() as u32;
    let qr_px = (module_count + QUIET * 2) * MODULE_PX;
    let bubble_size = qr_px + BUBBLE_PAD * 2;

    let bubble_x = strip_x + QR_MARGIN;
    let bubble_y = header_h.saturating_sub(bubble_size) / 2;
    let qr_x0 = bubble_x + BUBBLE_PAD;
    let qr_y0 = bubble_y + BUBBLE_PAD;

    fill_rounded_rect_blend(img, bubble_x, bubble_y, bubble_size, bubble_size,
        BUBBLE_RADIUS, theme.qr_bubble, img_w, header_h);

    let colors = code.to_colors();
    for my in 0..module_count {
        for mx in 0..module_count {
            if is_finder_area(mx, my, module_count) { continue; }
            let idx = (my * module_count + mx) as usize;
            if colors[idx] != qrcode::Color::Dark { continue; }

            let px_start = qr_x0 + (QUIET + mx) * MODULE_PX;
            let py_start = qr_y0 + (QUIET + my) * MODULE_PX;

            let t = my as f32 / module_count.max(1) as f32;
            let module_color = Rgba([
                lerp(theme.qr_module_a[0], theme.qr_module_b[0], t),
                lerp(theme.qr_module_a[1], theme.qr_module_b[1], t),
                lerp(theme.qr_module_a[2], theme.qr_module_b[2], t),
                255,
            ]);

            for dy in 0..MODULE_PX {
                for dx in 0..MODULE_PX {
                    let px = px_start + dx;
                    let py = py_start + dy;
                    if px < img_w && py < header_h {
                        img.put_pixel(px, py, module_color);
                    }
                }
            }
        }
    }

    // Rounded finder patterns
    let finder_origins: &[(u32, u32)] = &[
        (0, 0),
        (module_count - 7, 0),
        (0, module_count - 7),
    ];
    let r3 = MODULE_PX * 3;
    for &(fmx, fmy) in finder_origins {
        let fx = qr_x0 + (QUIET + fmx) * MODULE_PX;
        let fy = qr_y0 + (QUIET + fmy) * MODULE_PX;
        let t = fmy as f32 / module_count.max(1) as f32;
        let fd = [
            lerp(theme.qr_module_a[0], theme.qr_module_b[0], t),
            lerp(theme.qr_module_a[1], theme.qr_module_b[1], t),
            lerp(theme.qr_module_a[2], theme.qr_module_b[2], t),
        ];
        fill_rounded_rect_opaque(img, fx, fy,
            MODULE_PX * 7, MODULE_PX * 7, r3, theme.qr_finder_dark, img_w, header_h);
        fill_rounded_rect_opaque(img, fx + MODULE_PX, fy + MODULE_PX,
            MODULE_PX * 5, MODULE_PX * 5, r3, theme.qr_finder_light, img_w, header_h);
        fill_rounded_rect_opaque(img, fx + MODULE_PX * 2, fy + MODULE_PX * 2,
            MODULE_PX * 3, MODULE_PX * 3, r3, fd, img_w, header_h);
    }
}

/// Returns true for modules that belong to a finder pattern (including separator row/col).
fn is_finder_area(mx: u32, my: u32, n: u32) -> bool {
    let s = 8u32; // 7-module finder + 1-module separator
    (mx < s && my < s) || (mx >= n - 7 && my < s) || (mx < s && my >= n - 7)
}

fn fill_rounded_rect_blend(
    img: &mut RgbaImage,
    x: u32, y: u32, w: u32, h: u32, r: u32,
    color: [u8; 4],
    max_w: u32, max_h: u32,
) {
    let base_alpha = color[3] as f32 / 255.0;
    for py in y.saturating_sub(1)..y.saturating_add(h + 1).min(max_h) {
        for px in x.saturating_sub(1)..x.saturating_add(w + 1).min(max_w) {
            let cov = rounded_rect_coverage(px, py, x, y, w, h, r);
            if cov <= 0.0 { continue; }
            let alpha = base_alpha * cov;
            let p = img.get_pixel_mut(px, py);
            let c = p.0.as_mut_slice();
            c[0] = (c[0] as f32 * (1.0 - alpha) + color[0] as f32 * alpha).round() as u8;
            c[1] = (c[1] as f32 * (1.0 - alpha) + color[1] as f32 * alpha).round() as u8;
            c[2] = (c[2] as f32 * (1.0 - alpha) + color[2] as f32 * alpha).round() as u8;
            c[3] = 255;
        }
    }
}

fn fill_rounded_rect_opaque(
    img: &mut RgbaImage,
    x: u32, y: u32, w: u32, h: u32, r: u32,
    color: [u8; 3],
    max_w: u32, max_h: u32,
) {
    for py in y.saturating_sub(1)..y.saturating_add(h + 1).min(max_h) {
        for px in x.saturating_sub(1)..x.saturating_add(w + 1).min(max_w) {
            let cov = rounded_rect_coverage(px, py, x, y, w, h, r);
            if cov <= 0.0 { continue; }
            let p = img.get_pixel_mut(px, py);
            let c = p.0.as_mut_slice();
            c[0] = (c[0] as f32 * (1.0 - cov) + color[0] as f32 * cov).round() as u8;
            c[1] = (c[1] as f32 * (1.0 - cov) + color[1] as f32 * cov).round() as u8;
            c[2] = (c[2] as f32 * (1.0 - cov) + color[2] as f32 * cov).round() as u8;
            c[3] = 255;
        }
    }
}

/// Returns anti-aliased coverage [0.0, 1.0] for a pixel in a rounded rectangle.
/// Uses pixel center coordinates for sub-pixel accuracy at corner edges.
fn rounded_rect_coverage(px: u32, py: u32, x: u32, y: u32, w: u32, h: u32, r: u32) -> f32 {
    let pxf = px as f32 + 0.5;
    let pyf = py as f32 + 0.5;
    let xf = x as f32;
    let yf = y as f32;
    let wf = w as f32;
    let hf = h as f32;
    let rf = (r as f32).min(wf / 2.0).min(hf / 2.0);
    if pxf < xf || pxf > xf + wf || pyf < yf || pyf > yf + hf { return 0.0; }
    let near_h = pxf < xf + rf || pxf > xf + wf - rf;
    let near_v = pyf < yf + rf || pyf > yf + hf - rf;
    if !near_h || !near_v { return 1.0; }
    let cx = if pxf < xf + rf { xf + rf } else { xf + wf - rf };
    let cy = if pyf < yf + rf { yf + rf } else { yf + hf - rf };
    let dist = ((pxf - cx).powi(2) + (pyf - cy).powi(2)).sqrt();
    (rf + 0.5 - dist).clamp(0.0, 1.0)
}

fn lerp(a: u8, b: u8, t: f32) -> u8 {
    (a as f32 + (b as f32 - a as f32) * t).round() as u8
}
