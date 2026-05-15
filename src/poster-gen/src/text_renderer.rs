// Overlay text rendering with cosmic-text / pixel font

use image::{Pixel, RgbImage};

pub const HEADER_H: u32 = 72;
const MARGIN: u32 = 8;

/// RGBA theme colors
#[derive(Clone)]
pub struct ThemeColors {
    pub header_bg: [u8; 4],  // RGBA
    pub text_color: [u8; 3], // RGB
    pub accent_color: [u8; 3],
    pub badge_bg: [u8; 4],   // RGBA for per-frame timestamp badge
    pub badge_text: [u8; 3],
}

pub struct OverlayConfig {
    pub branding_enabled: bool,
    pub branding_text: String,
    pub video_info_enabled: bool,
    pub show_file_size: bool,
    pub show_resolution_fps: bool,
    pub show_video_encoding: bool,
    pub show_audio_encoding: bool,
    pub show_duration: bool,
    pub show_frame_timestamp: bool,
    pub color_theme: String,
    pub font_path: Option<String>,
    /// Overlay label language: "en" | "zh" | "ja" (ASCII pixel font; CJK labels planned for future)
    pub lang: String,
    /// per-frame timestamps, one per cell (row-major order)
    pub frame_timestamps: Vec<f64>,
    pub rows: u32,
    pub cols: u32,
    pub cell_width: u32,
    pub cell_height: u32,
}

pub fn get_theme(name: &str) -> ThemeColors {
    match name {
        "dark" => ThemeColors {
            header_bg: [18, 18, 18, 200],
            text_color: [220, 220, 220],
            accent_color: [100, 180, 255],
            badge_bg: [18, 18, 18, 180],
            badge_text: [200, 200, 200],
        },
        "light" => ThemeColors {
            header_bg: [240, 240, 240, 200],
            text_color: [30, 30, 30],
            accent_color: [0, 100, 200],
            badge_bg: [240, 240, 240, 160],
            badge_text: [30, 30, 30],
        },
        "cinematic" => ThemeColors {
            header_bg: [10, 5, 0, 210],
            text_color: [255, 230, 180],
            accent_color: [200, 150, 50],
            badge_bg: [10, 5, 0, 190],
            badge_text: [255, 230, 180],
        },
        "minimal" => ThemeColors {
            header_bg: [0, 0, 0, 100],
            text_color: [255, 255, 255],
            accent_color: [255, 255, 255],
            badge_bg: [0, 0, 0, 100],
            badge_text: [255, 255, 255],
        },
        // "classic" and default
        _ => ThemeColors {
            header_bg: [0, 0, 0, 180],
            text_color: [255, 255, 255],
            accent_color: [0, 164, 220],
            badge_bg: [0, 0, 0, 160],
            badge_text: [255, 255, 255],
        },
    }
}

pub fn render_overlay(
    img: &mut RgbImage,
    info: &crate::media_info::MediaInfo,
    cfg: &OverlayConfig,
) {
    let theme = get_theme(&cfg.color_theme);
    let img_width = img.width();
    let img_height = img.height();

    let has_header = cfg.video_info_enabled || cfg.branding_enabled;
    if !has_header {
        // No header: only render per-frame timestamp badges and return
        if cfg.show_frame_timestamp && !cfg.frame_timestamps.is_empty() {
            let badge_h = 12u32;
            let badge_pad = 2u32;
            let b_scale = 1u32;
            let b_char_w = (5 + 1) * b_scale;

            for row in 0..cfg.rows {
                for col in 0..cfg.cols {
                    let idx = (row * cfg.cols + col) as usize;
                    if idx >= cfg.frame_timestamps.len() { break; }
                    let ts = cfg.frame_timestamps[idx];
                    let ts_str = secs_to_hhmmss(ts);

                    let cell_x = col * cfg.cell_width;
                    let cell_y = row * cfg.cell_height;

                    let badge_w = ts_str.len() as u32 * b_char_w + badge_pad * 2;
                    let bx = cell_x + badge_pad;
                    let by = cell_y + cfg.cell_height.saturating_sub(badge_h + badge_pad);

                    if by + badge_h > img_height || bx + badge_w > img_width { continue; }

                    fill_rect_alpha(img, bx, by, badge_w, badge_h, theme.badge_bg);
                    draw_text_scaled(img, &ts_str, bx + badge_pad, by + badge_pad, b_scale, theme.badge_text);
                }
            }
        }
        return;
    }

    // Header background
    fill_rect_alpha(img, 0, 0, img_width, HEADER_H, theme.header_bg);

    // Decorative disc in top-right of header (like MPCHC style)
    draw_disc_decoration(img, img_width, HEADER_H, &theme);

    let scale = 2u32;
    let char_stride = (5 + 1) * scale; // 12px per char
    let line_h = (7 + 1) * scale;      // 16px per line

    // Branding uses a larger scale for visual prominence
    let brand_scale = 3u32;
    let brand_char_stride = (5 + 1) * brand_scale; // 18px per char

    // Branding width (reserve space on right side of filename row)
    let branding_len = if cfg.branding_enabled && !cfg.branding_text.is_empty() {
        cfg.branding_text.len() as u32
    } else { 0 };
    let branding_w = branding_len * brand_char_stride + MARGIN;

    let mut y = MARGIN;

    // Row 0: Filename (left) + Branding (right, larger scale)
    if cfg.video_info_enabled {
        let available = img_width.saturating_sub(if branding_len > 0 { branding_w + MARGIN } else { MARGIN });
        let max_chars = (available / char_stride) as usize;
        let filename: String = if info.filename.chars().count() > max_chars {
            let mut s: String = info.filename.chars().take(max_chars.saturating_sub(2)).collect();
            s.push_str("..");
            s
        } else {
            info.filename.clone()
        };
        draw_text_scaled(img, &filename, MARGIN, y, scale, theme.accent_color);
    }
    if cfg.branding_enabled && !cfg.branding_text.is_empty() {
        let brand_h = 7 * brand_scale; // 21px
        let by = HEADER_H.saturating_sub(brand_h + MARGIN);
        let bx = img_width.saturating_sub(branding_len * brand_char_stride + MARGIN);
        draw_text_scaled(img, &cfg.branding_text, bx, by, brand_scale, theme.accent_color);
    }

    y += line_h;

    // Labels vary by language (ASCII-only pixel font; CJK planned for future)
    let lbl_size  = match cfg.lang.as_str() { _ => "Size:" };
    let lbl_dur   = match cfg.lang.as_str() { _ => "Dur:" };
    let lbl_cs    = match cfg.lang.as_str() { _ => "CS:" };
    let lbl_audio = match cfg.lang.as_str() { _ => "Audio:" };
    let lbl_sr    = match cfg.lang.as_str() { _ => "SR:" };

    // Row 1: Size + Duration
    if cfg.video_info_enabled {
        let mut parts: Vec<String> = Vec::new();
        if cfg.show_file_size { parts.push(format!("{} {}", lbl_size, info.file_size)); }
        if cfg.show_duration { parts.push(format!("{} {}", lbl_dur, info.duration)); }
        if !parts.is_empty() {
            draw_text_scaled(img, &parts.join("   "), MARGIN, y, scale, theme.text_color);
            y += line_h;
        }
    }

    // Row 2: Resolution + FPS + Video codec + Colour space
    if cfg.video_info_enabled {
        let mut parts: Vec<String> = Vec::new();
        if cfg.show_resolution_fps {
            parts.push(format!("{}  {:.0}fps", info.resolution, info.fps));
        }
        if cfg.show_video_encoding {
            let mut enc = info.video_codec.clone();
            if let Some(bd) = info.bit_depth { enc.push_str(&format!(" {}bit", bd)); }
            if let Some(ref hdr) = info.hdr_type { enc.push(' '); enc.push_str(hdr); }
            if let Some(ref cs) = info.colour_space { enc.push_str(&format!("  {} {}", lbl_cs, cs)); }
            parts.push(enc);
        }
        if !parts.is_empty() {
            draw_text_scaled(img, &parts.join("   "), MARGIN, y, scale, theme.text_color);
            y += line_h;
        }
    }

    // Row 3: Audio codec + format + bitrate + sample rate + track count
    if cfg.video_info_enabled && cfg.show_audio_encoding {
        if let Some(ref ac) = info.audio_codec {
            let mut audio = format!("{} {}", lbl_audio, ac);
            if let Some(ref af) = info.audio_format { audio.push(' '); audio.push_str(af); }
            if let Some(ref abr) = info.audio_bitrate { audio.push_str(&format!(" @ {}", abr)); }
            if let Some(sr) = info.audio_sample_rate {
                audio.push_str(&format!("  {} {}kHz", lbl_sr, sr / 1000));
            }
            if info.audio_tracks > 1 { audio.push_str(&format!(" (x{})", info.audio_tracks)); }
            if y + line_h <= HEADER_H + (img_height - HEADER_H) {
                draw_text_scaled(img, &audio, MARGIN, y, scale, theme.text_color);
            }
        }
    }

    // Per-frame timestamp badges (scale=1 for compactness)
    if cfg.show_frame_timestamp && !cfg.frame_timestamps.is_empty() {
        let badge_h = 12u32;
        let badge_pad = 2u32;
        let b_scale = 1u32;
        let b_char_w = (5 + 1) * b_scale;

        for row in 0..cfg.rows {
            for col in 0..cfg.cols {
                let idx = (row * cfg.cols + col) as usize;
                if idx >= cfg.frame_timestamps.len() { break; }
                let ts = cfg.frame_timestamps[idx];
                let ts_str = secs_to_hhmmss(ts);

                let cell_x = col * cfg.cell_width;
                let cell_y = row * cfg.cell_height + HEADER_H;

                let badge_w = ts_str.len() as u32 * b_char_w + badge_pad * 2;
                let bx = cell_x + badge_pad;
                let by = cell_y + cfg.cell_height.saturating_sub(badge_h + badge_pad);

                if by + badge_h > img_height || bx + badge_w > img_width { continue; }

                fill_rect_alpha(img, bx, by, badge_w, badge_h, theme.badge_bg);
                draw_text_scaled(img, &ts_str, bx + badge_pad, by + badge_pad, b_scale, theme.badge_text);
            }
        }
    }
}

/// Draw a decorative disc watermark in the top-right of the header (inspired by MPCHC style).
fn draw_disc_decoration(img: &mut RgbImage, img_width: u32, header_h: u32, theme: &ThemeColors) {
    // Centre of disc: right side of header, vertically centred
    let cx = img_width.saturating_sub(header_h / 2 + 4) as i32;
    let cy = (header_h / 2) as i32;
    let max_r = (header_h as i32 * 3 / 4).max(20);

    // Ring definitions: (radius, ring_width, alpha_fraction)
    let rings: &[(i32, i32, f32)] = &[
        (max_r,        2, 0.18),
        (max_r * 6/7,  2, 0.14),
        (max_r * 4/7,  2, 0.12),
        (max_r * 2/7,  2, 0.10),
        (max_r * 1/7,  4, 0.20), // hub
    ];

    let iw = img_width as i32;
    let ih = header_h as i32;

    // Dim disc fill for inner area (very subtle)
    for dy in -max_r..=max_r {
        for dx in -max_r..=max_r {
            let d2 = dx * dx + dy * dy;
            let r2 = max_r * max_r;
            if d2 > r2 { continue; }
            let px = cx + dx;
            let py = cy + dy;
            if px < 0 || py < 0 || px >= iw || py >= ih { continue; }
            // radial gradient from center outward, very faint
            let t = (d2 as f32 / r2 as f32).sqrt();
            let alpha = 0.04 + t * 0.02; // 4–6% opacity fill
            let pixel = img.get_pixel_mut(px as u32, py as u32);
            let ch = pixel.0.as_mut_slice();
            ch[0] = blend(ch[0], 180.0, alpha);
            ch[1] = blend(ch[1], 180.0, alpha);
            ch[2] = blend(ch[2], 180.0, alpha);
        }
    }

    // Draw concentric rings
    for &(r, rw, alpha) in rings {
        let r_outer = r;
        let r_inner = (r - rw).max(0);
        let r_o2 = r_outer * r_outer;
        let r_i2 = r_inner * r_inner;
        let col = [
            theme.accent_color[0] as f32 * 0.5 + 90.0,
            theme.accent_color[1] as f32 * 0.5 + 90.0,
            theme.accent_color[2] as f32 * 0.5 + 90.0,
        ];
        for dy in -r_outer..=r_outer {
            for dx in -r_outer..=r_outer {
                let d2 = dx * dx + dy * dy;
                if d2 > r_o2 || d2 < r_i2 { continue; }
                let px = cx + dx;
                let py = cy + dy;
                if px < 0 || py < 0 || px >= iw || py >= ih { continue; }
                let pixel = img.get_pixel_mut(px as u32, py as u32);
                let ch = pixel.0.as_mut_slice();
                ch[0] = blend(ch[0], col[0], alpha);
                ch[1] = blend(ch[1], col[1], alpha);
                ch[2] = blend(ch[2], col[2], alpha);
            }
        }
    }
}

/// Alpha-blend a rectangle onto the image.
fn fill_rect_alpha(img: &mut RgbImage, x: u32, y: u32, w: u32, h: u32, color: [u8; 4]) {
    let alpha = color[3] as f32 / 255.0;
    let r = color[0] as f32;
    let g = color[1] as f32;
    let b = color[2] as f32;

    let img_w = img.width();
    let img_h = img.height();

    for py in y..y.saturating_add(h).min(img_h) {
        for px in x..x.saturating_add(w).min(img_w) {
            let pixel = img.get_pixel_mut(px, py);
            let channels = pixel.channels_mut();
            channels[0] = blend(channels[0], r, alpha);
            channels[1] = blend(channels[1], g, alpha);
            channels[2] = blend(channels[2], b, alpha);
        }
    }
}

#[inline]
fn blend(bg: u8, fg: f32, alpha: f32) -> u8 {
    ((bg as f32) * (1.0 - alpha) + fg * alpha).round().clamp(0.0, 255.0) as u8
}

/// Draw an ASCII string using the built-in 5×7 pixel font, scaled by `scale` pixels per bitmap pixel.
fn draw_text_scaled(img: &mut RgbImage, text: &str, x: u32, y: u32, scale: u32, color: [u8; 3]) {
    let char_stride = (5 + 1) * scale;
    let img_w = img.width();
    let img_h = img.height();
    for (i, ch) in text.chars().enumerate() {
        let cx = x.saturating_add(i as u32 * char_stride);
        if cx >= img_w { break; }
        let bitmap = char_bitmap(ch);
        for (row, &bits) in bitmap.iter().enumerate() {
            for bit in 0..5u32 {
                if (bits >> (4 - bit)) & 1 == 1 {
                    for sy in 0..scale {
                        for sx in 0..scale {
                            let px = cx + bit * scale + sx;
                            let py = y + row as u32 * scale + sy;
                            if px < img_w && py < img_h {
                                let pixel = img.get_pixel_mut(px, py);
                                let ch_arr = pixel.channels_mut();
                                ch_arr[0] = color[0];
                                ch_arr[1] = color[1];
                                ch_arr[2] = color[2];
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Returns a 7-row × 5-col bitmap for printable ASCII chars.
/// Each row is a u8 bitmask of 5 bits (MSB = leftmost pixel).
fn char_bitmap(c: char) -> [u8; 7] {
    match c {
        ' ' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        '!' => [0x04, 0x04, 0x04, 0x04, 0x00, 0x04, 0x00],
        '"' => [0x0A, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00],
        '#' => [0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0x00, 0x00],
        '$' => [0x0E, 0x15, 0x0C, 0x06, 0x15, 0x0E, 0x00],
        '%' => [0x19, 0x1A, 0x02, 0x04, 0x0B, 0x13, 0x00],
        '&' => [0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D],
        '\'' => [0x04, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00],
        '(' => [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
        ')' => [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
        '*' => [0x00, 0x0A, 0x04, 0x1F, 0x04, 0x0A, 0x00],
        '+' => [0x00, 0x04, 0x04, 0x1F, 0x04, 0x04, 0x00],
        ',' => [0x00, 0x00, 0x00, 0x00, 0x04, 0x04, 0x08],
        '-' => [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00],
        '.' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00],
        '/' => [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
        '0' => [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
        '1' => [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
        '2' => [0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F],
        '3' => [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
        '4' => [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
        '5' => [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
        '6' => [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
        '7' => [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
        '8' => [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
        '9' => [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x1C],
        ':' => [0x00, 0x04, 0x00, 0x00, 0x04, 0x00, 0x00],
        ';' => [0x00, 0x04, 0x00, 0x00, 0x04, 0x04, 0x08],
        '<' => [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
        '=' => [0x00, 0x1F, 0x00, 0x00, 0x1F, 0x00, 0x00],
        '>' => [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
        '?' => [0x0E, 0x11, 0x01, 0x06, 0x04, 0x00, 0x04],
        '@' => [0x0E, 0x11, 0x17, 0x15, 0x17, 0x10, 0x0E],
        'A' => [0x04, 0x0A, 0x11, 0x1F, 0x11, 0x11, 0x11],
        'B' => [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
        'C' => [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
        'D' => [0x1E, 0x09, 0x11, 0x11, 0x11, 0x09, 0x1E],
        'E' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
        'F' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
        'G' => [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
        'H' => [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
        'I' => [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
        'J' => [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
        'K' => [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
        'L' => [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
        'M' => [0x11, 0x1B, 0x15, 0x11, 0x11, 0x11, 0x11],
        'N' => [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
        'O' => [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'P' => [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
        'Q' => [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
        'R' => [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
        'S' => [0x0E, 0x11, 0x10, 0x0E, 0x01, 0x11, 0x0E],
        'T' => [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        'U' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'V' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
        'W' => [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
        'X' => [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
        'Y' => [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
        'Z' => [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
        '[' => [0x0E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0E],
        '\\' => [0x10, 0x08, 0x08, 0x04, 0x02, 0x02, 0x01],
        ']' => [0x0E, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0E],
        '^' => [0x04, 0x0A, 0x11, 0x00, 0x00, 0x00, 0x00],
        '_' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F],
        '`' => [0x08, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00],
        'a' => [0x00, 0x00, 0x0E, 0x01, 0x0F, 0x11, 0x0F],
        'b' => [0x10, 0x10, 0x1E, 0x11, 0x11, 0x11, 0x1E],
        'c' => [0x00, 0x00, 0x0E, 0x10, 0x10, 0x11, 0x0E],
        'd' => [0x01, 0x01, 0x0F, 0x11, 0x11, 0x11, 0x0F],
        'e' => [0x00, 0x00, 0x0E, 0x11, 0x1F, 0x10, 0x0E],
        'f' => [0x06, 0x09, 0x08, 0x1C, 0x08, 0x08, 0x08],
        'g' => [0x00, 0x00, 0x0F, 0x11, 0x0F, 0x01, 0x0E],
        'h' => [0x10, 0x10, 0x1E, 0x11, 0x11, 0x11, 0x11],
        'i' => [0x04, 0x00, 0x0C, 0x04, 0x04, 0x04, 0x0E],
        'j' => [0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0C],
        'k' => [0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12],
        'l' => [0x0C, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
        'm' => [0x00, 0x00, 0x1A, 0x15, 0x15, 0x11, 0x11],
        'n' => [0x00, 0x00, 0x1E, 0x11, 0x11, 0x11, 0x11],
        'o' => [0x00, 0x00, 0x0E, 0x11, 0x11, 0x11, 0x0E],
        'p' => [0x00, 0x00, 0x1E, 0x11, 0x1E, 0x10, 0x10],
        'q' => [0x00, 0x00, 0x0F, 0x11, 0x0F, 0x01, 0x01],
        'r' => [0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10],
        's' => [0x00, 0x00, 0x0E, 0x10, 0x0E, 0x01, 0x1E],
        't' => [0x08, 0x08, 0x1C, 0x08, 0x08, 0x09, 0x06],
        'u' => [0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0D],
        'v' => [0x00, 0x00, 0x11, 0x11, 0x11, 0x0A, 0x04],
        'w' => [0x00, 0x00, 0x11, 0x11, 0x15, 0x15, 0x0A],
        'x' => [0x00, 0x00, 0x11, 0x0A, 0x04, 0x0A, 0x11],
        'y' => [0x00, 0x00, 0x11, 0x11, 0x0F, 0x01, 0x0E],
        'z' => [0x00, 0x00, 0x1F, 0x02, 0x04, 0x08, 0x1F],
        '{' => [0x03, 0x04, 0x04, 0x08, 0x04, 0x04, 0x03],
        '|' => [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        '}' => [0x18, 0x04, 0x04, 0x02, 0x04, 0x04, 0x18],
        '~' => [0x00, 0x08, 0x15, 0x02, 0x00, 0x00, 0x00],
        // Unicode: × (multiplication sign U+00D7)
        '\u{d7}' => [0x00, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x00],
        // fallback: solid block
        _ => [0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F],
    }
}

fn secs_to_hhmmss(secs: f64) -> String {
    let total = secs as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{h:02}:{m:02}:{s:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_named_themes_have_visible_text() {
        for name in ["classic", "dark", "light", "cinematic", "minimal"] {
            let t = get_theme(name);
            // Alpha must be meaningfully opaque (>= 50) so the overlay is actually visible
            assert!(t.header_bg[3] >= 50, "{name}: header alpha too low ({}) — overlay won't show", t.header_bg[3]);
            assert!(t.badge_bg[3] >= 50, "{name}: badge alpha too low ({}) — badge won't show", t.badge_bg[3]);
            let text_visible = t.text_color.iter().any(|&c| c > 0);
            assert!(text_visible, "{name}: text color is fully black (invisible)");
        }
    }

    #[test]
    fn unknown_theme_falls_back_to_classic() {
        let classic = get_theme("classic");
        let unknown = get_theme("xyz-nonexistent");
        assert_eq!(classic.header_bg, unknown.header_bg);
        assert_eq!(classic.text_color, unknown.text_color);
        assert_eq!(classic.accent_color, unknown.accent_color);
    }

    #[test]
    fn secs_to_hhmmss_zero() {
        assert_eq!(secs_to_hhmmss(0.0), "00:00:00");
    }

    #[test]
    fn secs_to_hhmmss_exact_hour() {
        assert_eq!(secs_to_hhmmss(3661.0), "01:01:01");
    }

    #[test]
    fn secs_to_hhmmss_large_hours() {
        assert_eq!(secs_to_hhmmss(36000.0), "10:00:00");
    }

    // T031: overlay hash determinism
    fn overlay_fingerprint(
        branding_text: &str,
        color_theme: &str,
        branding_enabled: bool,
        video_info_enabled: bool,
        show_timestamp: bool,
    ) -> String {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(branding_text.as_bytes());
        h.update(b"|");
        h.update(color_theme.as_bytes());
        h.update(b"|");
        h.update(if branding_enabled { b"1" } else { b"0" });
        h.update(b"|");
        h.update(if video_info_enabled { b"1" } else { b"0" });
        h.update(b"|");
        h.update(if show_timestamp { b"1" } else { b"0" });
        let result = h.finalize();
        result.iter().take(4).map(|b| format!("{:02x}", b)).collect()
    }

    #[test]
    fn same_overlay_settings_produce_same_fingerprint() {
        let a = overlay_fingerprint("Jellyfin Recents", "classic", true, true, false);
        let b = overlay_fingerprint("Jellyfin Recents", "classic", true, true, false);
        assert_eq!(a, b, "identical settings must hash identically");
        assert_eq!(a.len(), 8, "fingerprint must be 8 hex chars");
    }

    #[test]
    fn different_theme_produces_different_fingerprint() {
        let a = overlay_fingerprint("Jellyfin Recents", "dark", true, true, false);
        let b = overlay_fingerprint("Jellyfin Recents", "light", true, true, false);
        assert_ne!(a, b, "different themes must hash differently");
    }

    #[test]
    fn different_branding_text_produces_different_fingerprint() {
        let a = overlay_fingerprint("My Server", "classic", true, true, false);
        let b = overlay_fingerprint("Other Server", "classic", true, true, false);
        assert_ne!(a, b, "different branding text must hash differently");
    }

    #[test]
    fn toggling_field_changes_fingerprint() {
        let with_ts = overlay_fingerprint("Jellyfin Recents", "classic", true, true, true);
        let without_ts = overlay_fingerprint("Jellyfin Recents", "classic", true, true, false);
        assert_ne!(with_ts, without_ts, "toggling timestamp flag must change fingerprint");
    }
}
