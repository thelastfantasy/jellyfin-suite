use image::{Rgba, RgbaImage};
use qrcode::{EcLevel, QrCode};

const QR_URL: &str = "https://taosaka.com/g/js";
const MODULE_PX: u32 = 3;
const QUIET: u32 = 0;
const BUBBLE_PAD: u32 = 6;
const QR_MARGIN: u32 = 10;
const BUBBLE_RADIUS: u32 = 8;
const BADGE_RADIUS: u32 = 5; // rounded square corners for center badge
const BADGE_PAD: u32 = 4;   // padding around logo within badge
// badge_size = LOGO_PX + BADGE_PAD*2 = 35px ≈ 28% of qr_px (similar to Firefox QR proportions)
const LOGO_PX: u32 = 27;
// V5-M: 37 modules × 3px = 111px content. Bubble = 111 + BUBBLE_PAD*2 = 123px.
// QUIET=0: quiet zone is provided by BUBBLE_PAD instead of module slots.
const TARGET_QR_PX: u32 = 111;

fn make_qr() -> Option<QrCode> {
    QrCode::with_error_correction_level(QR_URL.as_bytes(), EcLevel::H).ok()
}

/// Returns the pixel width of the QR strip (143px).
pub fn qr_strip_width() -> u32 {
    QR_MARGIN + TARGET_QR_PX + BUBBLE_PAD * 2 + QR_MARGIN
}

/// Render the QR bubble into an already-allocated strip at x=[strip_x, strip_x+strip_w).
/// All coordinates are computed in float then rounded so the output always fits TARGET_QR_PX
/// regardless of which QR version the encoder picks (size is always equal to the V5-M baseline).
pub fn render_qr_in_strip(
    img: &mut RgbaImage,
    strip_x: u32,
    _strip_w: u32,
    header_h: u32,
    theme: &crate::text_renderer::ThemeColors,
) {
    let img_w = img.width();
    let code = match make_qr() { Some(c) => c, None => return };
    let module_count = code.width() as u32;

    // Pixel offset of the m-th module boundary within the QR area (including quiet zones).
    // effective_mpx may be fractional if the QR version differs from V5; rounding distributes
    // the sub-pixel error evenly so the total always sums to TARGET_QR_PX.
    let effective_mpx = TARGET_QR_PX as f32 / (module_count + QUIET * 2) as f32;
    let mpx = |m: u32| -> u32 { (m as f32 * effective_mpx).round() as u32 };

    let qr_px = TARGET_QR_PX;
    let bubble_size = qr_px + BUBBLE_PAD * 2;
    let bubble_x = strip_x + QR_MARGIN;
    let bubble_y = header_h.saturating_sub(bubble_size) / 2;
    let qr_x0 = bubble_x + BUBBLE_PAD;
    let qr_y0 = bubble_y + BUBBLE_PAD;

    fill_rounded_rect_blend(img, bubble_x, bubble_y, bubble_size, bubble_size,
        BUBBLE_RADIUS, theme.qr_bubble, img_w, header_h);

    // Badge bounds computed early so module loops can skip this area.
    // The badge uses blend (same as bubble) — modules are cleared underneath so no stripes.
    let badge_size = LOGO_PX + BADGE_PAD * 2; // 35px ≈ 28% of qr_px
    let badge_x = qr_x0 + qr_px / 2 - badge_size / 2;
    let badge_y = qr_y0 + qr_px / 2 - badge_size / 2;

    // Data modules
    let colors = code.to_colors();
    for my in 0..module_count {
        for mx in 0..module_count {
            if is_finder_area(mx, my, module_count) { continue; }
            let idx = (my * module_count + mx) as usize;
            if colors[idx] != qrcode::Color::Dark { continue; }

            let px0 = qr_x0 + mpx(QUIET + mx);
            let py0 = qr_y0 + mpx(QUIET + my);
            let pw  = mpx(QUIET + mx + 1) - mpx(QUIET + mx);
            let ph  = mpx(QUIET + my + 1) - mpx(QUIET + my);

            let t = my as f32 / module_count.max(1) as f32;
            let mc = Rgba([
                lerp(theme.qr_module_a[0], theme.qr_module_b[0], t),
                lerp(theme.qr_module_a[1], theme.qr_module_b[1], t),
                lerp(theme.qr_module_a[2], theme.qr_module_b[2], t),
                255,
            ]);
            for dy in 0..ph {
                for dx in 0..pw {
                    let px = px0 + dx; let py = py0 + dy;
                    if px >= img_w || py >= header_h { continue; }
                    // Skip pixels inside badge rounded rect (produces rounded-corner cutout)
                    if rounded_rect_coverage(px, py, badge_x, badge_y, badge_size, badge_size, BADGE_RADIUS) > 0.0 { continue; }
                    img.put_pixel(px, py, mc);
                }
            }
        }
    }

    // Rounded finder patterns — sizes derived from effective_mpx so they scale correctly
    let r = (effective_mpx * 3.0).round() as u32; // ≈ MODULE_PX*3 for V5
    let finder_origins: &[(u32, u32)] = &[(0, 0), (module_count - 7, 0), (0, module_count - 7)];
    for &(fmx, fmy) in finder_origins {
        let fx  = qr_x0 + mpx(QUIET + fmx);
        let fy  = qr_y0 + mpx(QUIET + fmy);
        let fw7 = mpx(QUIET + fmx + 7) - mpx(QUIET + fmx);
        let fh7 = mpx(QUIET + fmy + 7) - mpx(QUIET + fmy);
        let o1x = mpx(QUIET + fmx + 1) - mpx(QUIET + fmx);
        let o1y = mpx(QUIET + fmy + 1) - mpx(QUIET + fmy);
        let o2x = mpx(QUIET + fmx + 2) - mpx(QUIET + fmx);
        let o2y = mpx(QUIET + fmy + 2) - mpx(QUIET + fmy);
        let fw5 = fw7.saturating_sub(o1x * 2);
        let fh5 = fh7.saturating_sub(o1y * 2);
        let fw3 = fw7.saturating_sub(o2x * 2);
        let fh3 = fh7.saturating_sub(o2y * 2);
        let t = fmy as f32 / module_count.max(1) as f32;
        let fd = [
            lerp(theme.qr_module_a[0], theme.qr_module_b[0], t),
            lerp(theme.qr_module_a[1], theme.qr_module_b[1], t),
            lerp(theme.qr_module_a[2], theme.qr_module_b[2], t),
        ];
        fill_rounded_rect_opaque(img, fx,        fy,        fw7, fh7, r, theme.qr_finder_dark,  img_w, header_h);
        fill_rounded_rect_opaque(img, fx + o1x,  fy + o1y,  fw5, fh5, r, theme.qr_finder_light, img_w, header_h);
        fill_rounded_rect_opaque(img, fx + o2x,  fy + o2y,  fw3, fh3, r, fd,                    img_w, header_h);
    }

    // No badge fill needed — modules are cleared, bubble background already shows correctly.
    let logo_color = [
        lerp(theme.qr_module_a[0], theme.qr_module_b[0], 0.5),
        lerp(theme.qr_module_a[1], theme.qr_module_b[1], 0.5),
        lerp(theme.qr_module_a[2], theme.qr_module_b[2], 0.5),
    ];
    // SVG visual center is ~23/512 above the viewBox center; nudge down to compensate
    let logo_y_nudge = LOGO_PX * 23 / 512;
    crate::logo::render_logo_tinted(img, badge_x + BADGE_PAD, badge_y + BADGE_PAD + logo_y_nudge, LOGO_PX, logo_color);
}

/// Returns true for modules that belong to a finder pattern (including separator row/col).
fn is_finder_area(mx: u32, my: u32, n: u32) -> bool {
    let s = 8u32; // 7-module finder + 1-module separator
    (mx < s && my < s) || (mx >= n - 7 && my < s) || (mx < s && my >= n - 7)
}

fn fill_rounded_rect_blend(
    img: &mut RgbaImage,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    r: u32,
    color: [u8; 4],
    max_w: u32,
    max_h: u32,
) {
    let base_alpha = color[3] as f32 / 255.0;
    for py in y.saturating_sub(1)..y.saturating_add(h + 1).min(max_h) {
        for px in x.saturating_sub(1)..x.saturating_add(w + 1).min(max_w) {
            let cov = rounded_rect_coverage(px, py, x, y, w, h, r);
            if cov <= 0.0 {
                continue;
            }
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
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    r: u32,
    color: [u8; 3],
    max_w: u32,
    max_h: u32,
) {
    for py in y.saturating_sub(1)..y.saturating_add(h + 1).min(max_h) {
        for px in x.saturating_sub(1)..x.saturating_add(w + 1).min(max_w) {
            let cov = rounded_rect_coverage(px, py, x, y, w, h, r);
            if cov <= 0.0 {
                continue;
            }
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
    if pxf < xf || pxf > xf + wf || pyf < yf || pyf > yf + hf {
        return 0.0;
    }
    let near_h = pxf < xf + rf || pxf > xf + wf - rf;
    let near_v = pyf < yf + rf || pyf > yf + hf - rf;
    if !near_h || !near_v {
        return 1.0;
    }
    let cx = if pxf < xf + rf { xf + rf } else { xf + wf - rf };
    let cy = if pyf < yf + rf { yf + rf } else { yf + hf - rf };
    let dist = ((pxf - cx).powi(2) + (pyf - cy).powi(2)).sqrt();
    (rf + 0.5 - dist).clamp(0.0, 1.0)
}

fn lerp(a: u8, b: u8, t: f32) -> u8 {
    (a as f32 + (b as f32 - a as f32) * t).round() as u8
}
