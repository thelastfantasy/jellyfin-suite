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
/// The canvas must already be the correct total size (no expansion).
/// Only the header area [0, header_h) receives the QR bubble; body pixels are untouched.
/// `accent_color` is used to tint the bubble background for theme consistency.
pub fn render_qr_in_strip(
    img: &mut RgbaImage,
    strip_x: u32,
    _strip_w: u32,
    header_h: u32,
    header_bg: [u8; 4],
    accent_color: [u8; 3],
) {
    let img_w = img.width();

    let alpha_f = header_bg[3] as f32 / 255.0;
    let header_r = (header_bg[0] as f32 * alpha_f) as u8;
    let header_g = (header_bg[1] as f32 * alpha_f) as u8;
    let header_b = (header_bg[2] as f32 * alpha_f) as u8;

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

    let lum = 0.299 * header_r as f32 + 0.587 * header_g as f32 + 0.114 * header_b as f32;
    let is_dark_header = lum < 140.0;

    // Tint bubble background with 15% accent color for theme consistency
    let tint = |base: f32, a: u8| (base * 0.85 + a as f32 * 0.15).round() as u8;
    let bubble_fill: [u8; 4] = if is_dark_header {
        [tint(255.0, accent_color[0]), tint(255.0, accent_color[1]), tint(255.0, accent_color[2]), 215]
    } else {
        [25u8, 25, 25, 215]
    };
    // Jellyfin blue for finder patterns on dark headers; dark on light headers
    let finder_dark: [u8; 3] = if is_dark_header { [0, 164, 220] } else { [25, 25, 25] };
    let finder_light: [u8; 3] = if is_dark_header {
        [tint(255.0, accent_color[0]), tint(255.0, accent_color[1]), tint(255.0, accent_color[2])]
    } else {
        [235, 235, 235]
    };

    fill_rounded_rect_blend(img, bubble_x, bubble_y, bubble_size, bubble_size,
        BUBBLE_RADIUS, bubble_fill, img_w, header_h);

    let colors = code.to_colors();
    for my in 0..module_count {
        for mx in 0..module_count {
            if is_finder_area(mx, my, module_count) { continue; }
            let idx = (my * module_count + mx) as usize;
            if colors[idx] != qrcode::Color::Dark { continue; }

            let px_start = qr_x0 + (QUIET + mx) * MODULE_PX;
            let py_start = qr_y0 + (QUIET + my) * MODULE_PX;

            let module_color = if is_dark_header {
                let t = my as f32 / module_count.max(1) as f32;
                Rgba([lerp(170, 0, t), lerp(92, 164, t), lerp(195, 220, t), 255])
            } else {
                Rgba([finder_dark[0], finder_dark[1], finder_dark[2], 255])
            };

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

    // Rounder finder patterns: use MODULE_PX*3 radius (clamped by fill fn to half-size)
    let finder_origins: &[(u32, u32)] = &[
        (0, 0),
        (module_count - 7, 0),
        (0, module_count - 7),
    ];
    let r3 = MODULE_PX * 3; // 9px — gives visibly rounder corners
    for &(fmx, fmy) in finder_origins {
        let fx = qr_x0 + (QUIET + fmx) * MODULE_PX;
        let fy = qr_y0 + (QUIET + fmy) * MODULE_PX;

        // Use gradient-matched finder color based on vertical position
        let fd: [u8; 3] = if is_dark_header {
            let t = fmy as f32 / module_count.max(1) as f32;
            [lerp(170, 0, t), lerp(92, 164, t), lerp(195, 220, t)]
        } else {
            finder_dark
        };

        fill_rounded_rect_opaque(img, fx, fy,
            MODULE_PX * 7, MODULE_PX * 7, r3, fd, img_w, header_h);
        fill_rounded_rect_opaque(img, fx + MODULE_PX, fy + MODULE_PX,
            MODULE_PX * 5, MODULE_PX * 5, r3, finder_light, img_w, header_h);
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
