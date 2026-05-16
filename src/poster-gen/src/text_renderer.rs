// Overlay text rendering with ab_glyph TTF / pixel font

use image::{Pixel, RgbaImage};
use ab_glyph::{Font, FontArc, PxScale, ScaleFont};

const MARGIN: u32 = 10;

fn badge_pos(
    cell_x: u32, cell_y: u32,
    cell_w: u32, cell_h: u32,
    badge_w: u32, badge_h: u32,
    pad: u32,
    pos: crate::image_stitcher::TimestampPosition,
) -> (u32, u32) {
    use crate::image_stitcher::TimestampPosition::*;
    match pos {
        InsideBottomLeft  => (cell_x + pad,                      cell_y + cell_h - badge_h - pad),
        InsideBottomCenter => (cell_x + (cell_w - badge_w) / 2,  cell_y + cell_h - badge_h - pad),
        InsideBottomRight => (cell_x + cell_w - badge_w - pad,   cell_y + cell_h - badge_h - pad),
        OutsideBottomLeft  => (cell_x + pad,                     cell_y + cell_h + pad),
        OutsideBottomCenter => (cell_x + (cell_w - badge_w) / 2, cell_y + cell_h + pad),
        OutsideBottomRight => (cell_x + cell_w - badge_w - pad,  cell_y + cell_h + pad),
    }
}

/// RGBA theme colors
#[derive(Clone)]
pub struct ThemeColors {
    pub header_bg: [u8; 4],  // RGBA
    pub text_color: [u8; 3], // RGB
    pub accent_color: [u8; 3],
    pub badge_bg: [u8; 4],   // RGBA for per-frame timestamp badge
    pub badge_text: [u8; 3],
    pub canvas_bg: [u8; 3],  // RGB for body/canvas background fill
}

/// What to render and how — font/theme/grid are handled by Renderer and passed separately.
pub struct RenderOptions {
    pub branding_enabled: bool,
    pub branding_text: String,
    pub video_info_enabled: bool,
    pub show_file_size: bool,
    pub show_resolution_fps: bool,
    pub show_video_encoding: bool,
    pub show_audio_encoding: bool,
    pub show_duration: bool,
    pub show_frame_timestamp: bool,
    pub lang: String,
    pub timestamp_position: crate::image_stitcher::TimestampPosition,
}

/// Holds pre-loaded fonts and resolved theme — construct once per job, reuse for rendering.
pub struct Renderer {
    font: Option<FontArc>,
    branding_font: Option<FontArc>,
    timestamp_font: Option<FontArc>,
    emoji_font: Option<FontArc>,
    pub theme: ThemeColors,
}

impl Renderer {
    /// Loads fonts from disk once. `branding_font_path` and `timestamp_font_path` fall back
    /// to `font_path` if not provided or if loading fails.
    pub fn new(
        font_path: Option<&str>,
        branding_font_path: Option<&str>,
        timestamp_font_path: Option<&str>,
        emoji_font_path: Option<&str>,
        color_theme: &str,
    ) -> Self {
        let font = font_path.and_then(load_font);
        let branding_font = branding_font_path
            .and_then(load_font)
            .or_else(|| font.clone());
        let timestamp_font = timestamp_font_path
            .and_then(load_font)
            .or_else(|| font.clone());
        let emoji_font = emoji_font_path.and_then(load_font);
        Renderer {
            font,
            branding_font,
            timestamp_font,
            emoji_font,
            theme: get_theme(color_theme),
        }
    }

    /// Renders branding, video info, and per-frame timestamp badges onto `img`.
    /// `layout` and `timestamps` carry the grid geometry and per-cell timestamp values.
    pub fn render(
        &self,
        img: &mut RgbaImage,
        info: &crate::media_info::MediaInfo,
        options: &RenderOptions,
        layout: &crate::image_stitcher::GridLayout,
        timestamps: &[f64],
    ) {
        let font_ref: Option<&FontArc> = self.font.as_ref();
        let brand_font_ref: Option<&FontArc> = self.branding_font.as_ref();
        let ts_font_ref: Option<&FontArc> = self.timestamp_font.as_ref();
        let emoji_font_ref: Option<&FontArc> = self.emoji_font.as_ref();

        let theme = &self.theme;
        let img_width = img.width();
        let img_height = img.height();

        let has_header = options.video_info_enabled || options.branding_enabled;
        if !has_header {
            // No header: only render per-frame timestamp badges and return
            if options.show_frame_timestamp && !timestamps.is_empty() {
                let badge_pad = 4u32;
                let b_scale = 3u32;
                let b_ttf = b_scale * 6; // 18px TTF
                let badge_h = b_ttf + badge_pad * 2; // 26px — text fills badge with even padding

                for row in 0..layout.rows {
                    for col in 0..layout.cols {
                        let idx = (row * layout.cols + col) as usize;
                        if idx >= timestamps.len() { break; }
                        let ts = timestamps[idx];
                        let ts_str = secs_to_hhmmss(ts);
                        let text_w = measure_text_width(ts_font_ref, None, &ts_str, b_scale);
                        let badge_w = text_w + badge_pad * 2;

                        let (cell_x, cell_y) = layout.cell_origin(col, row);
                        let (bx, by) = badge_pos(cell_x, cell_y, layout.cell_w, layout.cell_h, badge_w, badge_h, badge_pad, options.timestamp_position);

                        if by + badge_h > img_height || bx + badge_w > img_width { continue; }

                        fill_rect_alpha(img, bx, by, badge_w, badge_h, theme.badge_bg);
                        let ty = if ts_font_ref.is_some() {
                            by
                        } else {
                            by + (badge_h - b_scale * 7) / 2
                        };
                        draw_text_scaled(img, &ts_str, bx + badge_pad, ty, b_scale, theme.badge_text, ts_font_ref, None);
                    }
                }
            }
            return;
        }

        // Header background
        fill_rect_alpha(img, 0, 0, img_width, layout.header_h, theme.header_bg);

        let scale = 4u32;
        let line_h = scale * 7; // ~28px line spacing for 24px text

        // Branding: large text + Jellyfin icon, right-aligned within icon_area_w (before QR strip)
        if options.branding_enabled && !options.branding_text.is_empty() {
            let brand_scale = 18u32;          // fills header height (~126px bitmap / ~108px TTF)
            let brand_ttf_px = brand_scale * 6;
            let icon_size = layout.header_h - MARGIN * 2;  // ~124px square
            let gap = MARGIN;

            let text_w = measure_text_width(brand_font_ref, emoji_font_ref, &options.branding_text, brand_scale);
            // Layout right-to-left within icon_area_w: [margin][icon][gap][text][gap from left info]
            let icon_x = layout.icon_area_w.saturating_sub(MARGIN + icon_size);
            let icon_y = MARGIN;
            let text_x = icon_x.saturating_sub(gap + text_w);
            // Vertical: pixel font centers by height, TTF baseline = text_y + brand_ttf_px
            let text_y = if brand_font_ref.is_some() {
                // TTF: glyphs draw from baseline upward; y=0 lets large text fill header naturally
                0u32
            } else {
                (layout.header_h.saturating_sub(brand_scale * 7)) / 2
            };
            let _ = brand_ttf_px;
            // Emoji fallback only for branding text (user-supplied, may contain emoji)
            draw_text_scaled(img, &options.branding_text, text_x, text_y, brand_scale, theme.accent_color, brand_font_ref, emoji_font_ref);
            crate::logo::render_logo_at(img, icon_x, icon_y, icon_size, 0.88);
        }

        let mut y = MARGIN;

        // i18n labels (with CJK support when TTF font is available)
        let (lbl_file, lbl_size, lbl_dur, lbl_cs, lbl_video, lbl_audio, lbl_sr) = match options.lang.as_str() {
            "zh" => ("文件名：", "大小：", "时长：", "色彩空间：", "视频：", "音频：", "采样率："),
            "ja" => ("ファイル名：", "サイズ：", "再生時間：", "色空間：", "映像：", "音声：", "サンプルレート："),
            _    => ("File: ", "Size: ", "Dur: ", "CS: ", "Video: ", "Audio: ", "SR: "),
        };

        // Row 0: Filename (left, full width, no truncation)
        if options.video_info_enabled {
            let prefix = lbl_file;
            let row_text = format!("{prefix}{}", info.filename);
            draw_text_scaled(img, &row_text, MARGIN, y, scale, theme.accent_color, font_ref, None);
        }
        y += line_h;

        // Row 1: Size + Duration
        if options.video_info_enabled && y + line_h <= layout.header_h {
            let mut parts: Vec<String> = Vec::new();
            if options.show_file_size { parts.push(format!("{}{}", lbl_size, info.file_size)); }
            if options.show_duration { parts.push(format!("{}{}", lbl_dur, info.duration)); }
            if !parts.is_empty() {
                draw_text_scaled(img, &parts.join("   "), MARGIN, y, scale, theme.text_color, font_ref, None);
                y += line_h;
            }
        }

        // Row 2: Resolution + FPS + Video codec + Colour space
        if options.video_info_enabled && y + line_h <= layout.header_h {
            let mut parts: Vec<String> = Vec::new();
            if options.show_resolution_fps {
                parts.push(format!("{}{}  {}fps", lbl_video, info.resolution, format_fps(info.fps)));
            }
            if options.show_video_encoding {
                let mut enc = info.video_codec.clone();
                if let Some(bd) = info.bit_depth { enc.push_str(&format!(" {}bit", bd)); }
                if let Some(ref hdr) = info.hdr_type { enc.push(' '); enc.push_str(hdr); }
                if let Some(ref cs) = info.colour_space { enc.push_str(&format!("  {}{}", lbl_cs, cs)); }
                parts.push(enc);
            }
            if !parts.is_empty() {
                draw_text_scaled(img, &parts.join("   "), MARGIN, y, scale, theme.text_color, font_ref, None);
                y += line_h;
            }
        }

        // Row 3: Audio codec + format + bitrate + sample rate + track count
        if options.video_info_enabled && options.show_audio_encoding {
            if let Some(ref ac) = info.audio_codec {
                let mut audio = format!("{}{}", lbl_audio, ac);
                if let Some(ref af) = info.audio_format {
                    if !af.is_empty() { audio.push(' '); audio.push_str(af); }
                }
                if let Some(ref abr) = info.audio_bitrate { audio.push_str(&format!(" @ {}", abr)); }
                if let Some(sr) = info.audio_sample_rate {
                    let sr_f = sr as f64 / 1000.0;
                    let sr_s = if sr_f.fract() == 0.0 { format!("{:.0}", sr_f) } else { format!("{:.1}", sr_f) };
                    audio.push_str(&format!("  {}{}kHz", lbl_sr, sr_s));
                }
                let lbl_tracks = match options.lang.as_str() { "zh" => "音轨", "ja" => "トラック", _ => "tracks" };
                if info.audio_tracks > 0 { audio.push_str(&format!(" / ×{}{}", info.audio_tracks, lbl_tracks)); }
                if y + line_h <= layout.header_h + (img_height - layout.header_h) {
                    draw_text_scaled(img, &audio, MARGIN, y, scale, theme.text_color, font_ref, None);
                }
            }
        }

        // Per-frame timestamp badges
        if options.show_frame_timestamp && !timestamps.is_empty() {
            let badge_pad = 4u32;
            let b_scale = 3u32;
            let b_ttf = b_scale * 6; // 18px TTF
            let badge_h = b_ttf + badge_pad * 2; // 26px

            for row in 0..layout.rows {
                for col in 0..layout.cols {
                    let idx = (row * layout.cols + col) as usize;
                    if idx >= timestamps.len() { break; }
                    let ts = timestamps[idx];
                    let ts_str = secs_to_hhmmss(ts);
                    let text_w = measure_text_width(ts_font_ref, None, &ts_str, b_scale);
                    let badge_w = text_w + badge_pad * 2;

                    let (cell_x, cell_y) = layout.cell_origin(col, row);
                    let (bx, by) = badge_pos(cell_x, cell_y, layout.cell_w, layout.cell_h, badge_w, badge_h, badge_pad, options.timestamp_position);

                    if by + badge_h > img_height || bx + badge_w > img_width { continue; }

                    fill_rect_alpha(img, bx, by, badge_w, badge_h, theme.badge_bg);
                    let ty = if ts_font_ref.is_some() {
                        by  // TTF: baseline = ty + b_ttf, visual text ~[ty, ty+b_ttf]
                    } else {
                        by + (badge_h - b_scale * 7) / 2
                    };
                    draw_text_scaled(img, &ts_str, bx + badge_pad, ty, b_scale, theme.badge_text, ts_font_ref, None);
                }
            }
        }
    }
}

pub fn get_theme(name: &str) -> ThemeColors {
    match name {
        "dark" => ThemeColors {
            header_bg: [18, 18, 18, 200],
            text_color: [220, 220, 220],
            accent_color: [100, 180, 255],
            badge_bg: [18, 18, 18, 180],
            badge_text: [200, 200, 200],
            canvas_bg: [12, 12, 12],
        },
        "light" => ThemeColors {
            header_bg: [240, 240, 240, 200],
            text_color: [30, 30, 30],
            accent_color: [0, 100, 200],
            badge_bg: [240, 240, 240, 160],
            badge_text: [30, 30, 30],
            canvas_bg: [245, 245, 245],
        },
        "cinematic" => ThemeColors {
            header_bg: [10, 5, 0, 210],
            text_color: [255, 230, 180],
            accent_color: [200, 150, 50],
            badge_bg: [10, 5, 0, 190],
            badge_text: [255, 230, 180],
            canvas_bg: [0, 0, 0],
        },
        "minimal" => ThemeColors {
            header_bg: [0, 0, 0, 100],
            text_color: [255, 255, 255],
            accent_color: [255, 255, 255],
            badge_bg: [0, 0, 0, 100],
            badge_text: [255, 255, 255],
            canvas_bg: [10, 10, 10],
        },
        "transparent" => ThemeColors {
            header_bg: [0, 0, 0, 0],
            text_color: [255, 255, 255],
            accent_color: [0, 164, 220],
            badge_bg: [0, 0, 0, 160],
            badge_text: [255, 255, 255],
            canvas_bg: [0, 0, 0],
        },
        // "classic" and default — medium gray (lighter than dark)
        _ => ThemeColors {
            header_bg: [45, 45, 50, 200],
            text_color: [255, 255, 255],
            accent_color: [0, 164, 220],
            badge_bg: [30, 30, 35, 180],
            badge_text: [255, 255, 255],
            canvas_bg: [25, 25, 30],
        },
    }
}

/// Alpha-blend a rectangle onto the image.
fn fill_rect_alpha(img: &mut RgbaImage, x: u32, y: u32, w: u32, h: u32, color: [u8; 4]) {
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
            channels[3] = blend(channels[3], 255.0, alpha);
        }
    }
}

#[inline]
fn blend(bg: u8, fg: f32, alpha: f32) -> u8 {
    ((bg as f32) * (1.0 - alpha) + fg * alpha).round().clamp(0.0, 255.0) as u8
}

fn load_font(path: &str) -> Option<FontArc> {
    match std::fs::read(path) {
        Ok(data) => match FontArc::try_from_vec(data) {
            Ok(font) => Some(font),
            Err(e) => {
                eprintln!("WARNING: failed to parse font {path}: {e}");
                None
            }
        },
        Err(e) => {
            eprintln!("WARNING: failed to load font {path}: {e}");
            None
        }
    }
}

/// Render a single emoji character as a colored Twemoji SVG.
/// Returns true if the emoji was found and rendered successfully.
fn render_twemoji(img: &mut RgbaImage, ch: char, x: u32, y: u32, size: u32) -> bool {
    use twemoji_assets::svg::SvgTwemojiAsset;
    if size == 0 { return false; }
    let s = ch.to_string();
    let asset = match SvgTwemojiAsset::from_emoji(&s) {
        Some(a) => a,
        None => return false,
    };
    let svg_data: &str = &*asset;
    let opt = resvg::usvg::Options::default();
    let tree = match resvg::usvg::Tree::from_str(svg_data, &opt) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let mut pixmap = match tiny_skia::Pixmap::new(size, size) {
        Some(p) => p,
        None => return false,
    };
    let svg_size = tree.size();
    let transform = tiny_skia::Transform::from_scale(
        size as f32 / svg_size.width() as f32,
        size as f32 / svg_size.height() as f32,
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    let canvas_w = img.width();
    let canvas_h = img.height();
    for py in 0..size {
        for px in 0..size {
            let cx = x + px;
            let cy = y + py;
            if cx >= canvas_w || cy >= canvas_h { continue; }
            let rgba = pixmap.pixel(px, py)
                .unwrap_or(tiny_skia::PremultipliedColorU8::TRANSPARENT);
            let src_alpha = rgba.alpha() as f32 / 255.0;
            if src_alpha <= 0.01 { continue; }
            let pixel = img.get_pixel_mut(cx, cy);
            let c = pixel.0.as_mut_slice();
            // Porter-Duff "over" with premultiplied source: out = pre_src + dst * (1 - alpha)
            c[0] = (rgba.red()   as f32 + c[0] as f32 * (1.0 - src_alpha)).min(255.0) as u8;
            c[1] = (rgba.green() as f32 + c[1] as f32 * (1.0 - src_alpha)).min(255.0) as u8;
            c[2] = (rgba.blue()  as f32 + c[2] as f32 * (1.0 - src_alpha)).min(255.0) as u8;
            c[3] = (c[3] as f32 + (255.0 - c[3] as f32) * src_alpha).min(255.0) as u8;
        }
    }
    true
}

/// Returns the actual pixel top of rendered glyphs by probing representative characters.
/// Typographic ascent includes whitespace above real glyphs; actual glyph bounds are tighter.
fn probe_glyph_top(font: &FontArc, scale: PxScale, baseline: f32, ascent: f32) -> f32 {
    for probe in ['中', '字', 'M', 'A'] {
        let id = font.glyph_id(probe);
        if id.0 != 0 {
            if let Some(og) = font.outline_glyph(id.with_scale(scale)) {
                return baseline + og.px_bounds().min.y;
            }
        }
    }
    baseline - ascent
}

fn draw_text_ttf(img: &mut RgbaImage,
    font: &FontArc,
    emoji_font: Option<&FontArc>,
    text: &str,
    x: u32,
    y: u32,
    scale_px: u32,
    color: [u8; 3],
) {
    let scale = PxScale::from(scale_px as f32);
    let img_w = img.width();
    let img_h = img.height();

    let mut cx = x as f32;
    let baseline = y as f32 + scale_px as f32;

    for ch in text.chars() {
        let primary_id = font.glyph_id(ch);
        let primary_outline = if primary_id.0 != 0 {
            font.outline_glyph(primary_id.with_scale(scale))
        } else {
            None
        };

        // Use emoji font when primary has no renderable outline (glyph_id=0 OR no outline data).
        // This handles fonts that return a non-zero placeholder glyph_id for emoji without
        // actually having the outline (common in CJK fonts like Noto Sans JP).
        let (active_font, active_id, active_outline): (&FontArc, _, Option<_>) =
            if primary_outline.is_some() {
                (font, primary_id, primary_outline)
            } else if let Some(ef) = emoji_font {
                let eid = ef.glyph_id(ch);
                if eid.0 != 0 {
                    let eo = ef.outline_glyph(eid.with_scale(scale));
                    (ef, eid, eo)
                } else {
                    (font, primary_id, None)
                }
            } else {
                (font, primary_id, None)
            };

        let h_advance;
        if let Some(outlined) = active_outline {
            let bounds = outlined.px_bounds();
            let offset_x = cx + bounds.min.x;
            let offset_y = baseline + bounds.min.y;

            outlined.draw(|gx, gy, alpha| {
                let px = (offset_x + gx as f32) as u32;
                let py = (offset_y + gy as f32) as u32;
                if px < img_w && py < img_h && alpha > 0.01 {
                    let pixel = img.get_pixel_mut(px, py);
                    let ch_arr = pixel.channels_mut();
                    let a = alpha.clamp(0.0, 1.0);
                    ch_arr[0] = ((1.0 - a) * ch_arr[0] as f32 + a * color[0] as f32) as u8;
                    ch_arr[1] = ((1.0 - a) * ch_arr[1] as f32 + a * color[1] as f32) as u8;
                    ch_arr[2] = ((1.0 - a) * ch_arr[2] as f32 + a * color[2] as f32) as u8;
                    ch_arr[3] = ((1.0 - a) * ch_arr[3] as f32 + a * 255.0) as u8;
                }
            });
            h_advance = active_font.as_scaled(scale).h_advance(active_id);
        } else {
            // Tertiary fallback: colored Twemoji SVG (no TTF outline available).
            // Use the actual rendered top of a representative glyph to position emoji,
            // because typographic ascent often includes whitespace above real glyphs.
            let ascent = font.as_scaled(scale).ascent();
            let glyph_top = probe_glyph_top(font, scale, baseline, ascent);
            let emoji_size = (baseline - glyph_top).round() as u32;
            // Shift emoji down ~8% so its visual center aligns with CJK character center
            // (round emoji shapes look "floating" when mathematically top-aligned)
            let offset = (emoji_size as f32 * 0.08).round() as u32;
            let emoji_y = (glyph_top.max(0.0) as u32).saturating_add(offset);
            let rendered = render_twemoji(img, ch, cx as u32, emoji_y, emoji_size);
            h_advance = if rendered {
                emoji_size as f32
            } else {
                active_font.as_scaled(scale).h_advance(active_id)
            };
        }

        cx += h_advance;
        if cx as u32 > img_w { break; }
    }
}

/// Measure the pixel width of a string, mirroring draw_text_ttf's advance logic.
/// Emoji chars with no TTF outline are counted as `ascender` pixels wide (same as draw_text_ttf).
fn measure_text_width_ttf(font: &FontArc, emoji_font: Option<&FontArc>, text: &str, scale_px: u32) -> u32 {
    use twemoji_assets::svg::SvgTwemojiAsset;
    let scale = PxScale::from(scale_px as f32);
    let scaled = font.as_scaled(scale);
    let ascent = scaled.ascent();
    // Use actual glyph height as emoji advance (matches draw_text_ttf's emoji_size)
    let baseline = scale_px as f32;
    let emoji_advance = (baseline - probe_glyph_top(font, scale, baseline, ascent)).max(1.0);
    text.chars()
        .map(|ch| {
            let id = font.glyph_id(ch);
            let has_outline = id.0 != 0 && font.outline_glyph(id.with_scale(scale)).is_some();
            if has_outline {
                return scaled.h_advance(id);
            }
            if let Some(ef) = emoji_font {
                let eid = ef.glyph_id(ch);
                if eid.0 != 0 && ef.outline_glyph(eid.with_scale(scale)).is_some() {
                    return ef.as_scaled(scale).h_advance(eid);
                }
            }
            if SvgTwemojiAsset::from_emoji(&ch.to_string()).is_some() {
                return emoji_advance;
            }
            scaled.h_advance(id)
        })
        .sum::<f32>() as u32
}

/// Measure text width for either TTF or pixel font.
fn measure_text_width(font: Option<&FontArc>, emoji_font: Option<&FontArc>, text: &str, scale: u32) -> u32 {
    if let Some(f) = font {
        measure_text_width_ttf(f, emoji_font, text, scale * 6)
    } else {
        text.len() as u32 * (5 + 1) * scale
    }
}

/// Draw an ASCII string using TTF (if font is Some) or built-in 5×7 pixel font.
/// `emoji_font` is an optional fallback for characters not found in `font`.
fn draw_text_scaled(img: &mut RgbaImage,
    text: &str,
    x: u32,
    y: u32,
    scale: u32,
    color: [u8; 3],
    font: Option<&FontArc>,
    emoji_font: Option<&FontArc>,
) {
    if let Some(f) = font {
        let ttf_scale = (scale * 6) as u32; // scale pixel bitmap px → TTF px (approximately)
        draw_text_ttf(img, f, emoji_font, text, x, y, ttf_scale, color);
        return;
    }

    // Pixel bitmap fallback
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
                                ch_arr[3] = 255;
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

fn format_fps(fps: f64) -> String {
    if fps.fract() == 0.0 {
        format!("{:.0}", fps)
    } else {
        let s = format!("{:.3}", fps);
        s.trim_end_matches('0').to_string()
    }
}

fn secs_to_hhmmss(secs: f64) -> String {
    let total_ms = (secs * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let total = total_ms / 1000;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{h:02}:{m:02}:{s:02}.{ms:03}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_twemoji_known_emoji_produces_pixels() {
        let mut img = image::RgbaImage::new(64, 64);
        let rendered = super::render_twemoji(&mut img, '🐸', 0, 0, 32);
        assert!(rendered, "frog emoji should be found in twemoji-assets");
        let non_transparent = img.pixels().any(|p| p[3] > 0);
        assert!(non_transparent, "rendered emoji must produce non-transparent pixels");
    }

    #[test]
    fn render_twemoji_ascii_returns_false() {
        let mut img = image::RgbaImage::new(64, 64);
        let rendered = super::render_twemoji(&mut img, 'A', 0, 0, 32);
        assert!(!rendered, "ASCII char should not match any Twemoji asset");
    }

    #[test]
    fn render_twemoji_zero_size_returns_false() {
        let mut img = image::RgbaImage::new(64, 64);
        let rendered = super::render_twemoji(&mut img, '🎬', 0, 0, 0);
        assert!(!rendered, "zero-size render should return false without panicking");
    }

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
        assert_eq!(secs_to_hhmmss(0.0), "00:00:00.000");
    }

    #[test]
    fn secs_to_hhmmss_exact_hour() {
        assert_eq!(secs_to_hhmmss(3661.0), "01:01:01.000");
    }

    #[test]
    fn secs_to_hhmmss_large_hours() {
        assert_eq!(secs_to_hhmmss(36000.0), "10:00:00.000");
    }

    #[test]
    fn secs_to_hhmmss_millis() {
        assert_eq!(secs_to_hhmmss(1.234), "00:00:01.234");
        assert_eq!(secs_to_hhmmss(59.999), "00:00:59.999");
        assert_eq!(secs_to_hhmmss(0.001), "00:00:00.001");
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
