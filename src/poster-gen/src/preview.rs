// Preview subcommand: placeholder grid + theme rendering

use image::{ImageEncoder, RgbImage};
use std::io::BufWriter;

use crate::media_info::MediaInfo;
use crate::text_renderer::{self, OverlayConfig};

pub struct PreviewArgs {
    pub output: String,
    pub color_theme: String,
    pub font_path: Option<String>,
    pub branding_enabled: bool,
    pub branding_text: String,
    pub video_info_enabled: bool,
    pub show_file_size: bool,
    pub show_resolution_fps: bool,
    pub show_video_encoding: bool,
    pub show_audio_encoding: bool,
    pub show_duration: bool,
    pub show_frame_timestamp: bool,
    pub rows: u32,
    pub cols: u32,
    pub lang: String,
}

/// Sample hardcoded MediaInfo for preview mode.
fn sample_media_info() -> MediaInfo {
    MediaInfo {
        filename: "sample-video.mkv".to_string(),
        file_size: "4.2 GB".to_string(),
        file_size_bytes: 4_509_715_660,
        resolution: "1920\u{d7}1080".to_string(),
        fps: 23.976,
        video_codec: "H.265".to_string(),
        bit_depth: Some(10),
        hdr_type: None,
        colour_space: Some("bt709".to_string()),
        audio_codec: Some("AAC".to_string()),
        audio_format: Some("stereo".to_string()),
        audio_bitrate: Some("192 kbps".to_string()),
        audio_sample_rate: Some(48000),
        audio_tracks: 1,
        duration: "01:23:45".to_string(),
        duration_secs: 5025.0,
    }
}

pub fn run_preview(args: PreviewArgs) -> Result<(), String> {
    let cols: u32 = args.cols;
    let rows: u32 = args.rows;
    let total_w = 1200u32;
    let cell_w: u32 = total_w / cols;
    let cell_h: u32 = cell_w * 9 / 16;
    let header_h: u32 = if args.video_info_enabled || args.branding_enabled {
        crate::text_renderer::HEADER_H
    } else {
        0
    };

    let grid_w = cols * cell_w;
    let grid_h = rows * cell_h + header_h;

    let mut grid = RgbImage::new(grid_w, grid_h);

    // Fill background black
    for pixel in grid.pixels_mut() {
        *pixel = image::Rgb([0u8, 0, 0]);
    }

    // Fill each cell with diagonal stripe placeholder
    let theme = text_renderer::get_theme(&args.color_theme);
    let base_greys: [u8; 6] = [45, 50, 55, 50, 55, 45];

    for row in 0..rows {
        for col in 0..cols {
            let idx = (row * cols + col) as usize;
            let grey = base_greys[idx % base_greys.len()];
            let cx = col * cell_w;
            let cy = row * cell_h + header_h;

            for py in cy..cy + cell_h {
                for px in cx..cx + cell_w {
                    let is_border = px == cx || px == cx + cell_w - 1 || py == cy || py == cy + cell_h - 1;
                    let color = if is_border {
                        image::Rgb([
                            (theme.accent_color[0] as u32 / 4) as u8,
                            (theme.accent_color[1] as u32 / 4) as u8,
                            (theme.accent_color[2] as u32 / 4) as u8,
                        ])
                    } else {
                        // Subtle diagonal stripe
                        let stripe = ((px - cx + py - cy) / 24) % 2;
                        image::Rgb([grey + stripe as u8 * 8, grey + stripe as u8 * 8, grey + stripe as u8 * 8])
                    };
                    grid.put_pixel(px, py, color);
                }
            }
        }
    }

    // Build sample timestamps (evenly spaced across sample duration)
    let duration_secs = 5025.0_f64;
    let total_frames = (rows * cols) as usize;
    let spacing = duration_secs / total_frames as f64;
    let frame_timestamps: Vec<f64> = (0..total_frames)
        .map(|i| spacing / 2.0 + i as f64 * spacing)
        .collect();

    let overlay_cfg = OverlayConfig {
        branding_enabled: args.branding_enabled,
        branding_text: args.branding_text.clone(),
        video_info_enabled: args.video_info_enabled,
        show_file_size: args.show_file_size,
        show_resolution_fps: args.show_resolution_fps,
        show_video_encoding: args.show_video_encoding,
        show_audio_encoding: args.show_audio_encoding,
        show_duration: args.show_duration,
        show_frame_timestamp: args.show_frame_timestamp,
        color_theme: args.color_theme.clone(),
        font_path: args.font_path.clone(),
        lang: args.lang.clone(),
        frame_timestamps,
        rows,
        cols,
        cell_width: cell_w,
        cell_height: cell_h,
    };

    let info = sample_media_info();
    text_renderer::render_overlay(&mut grid, &info, &overlay_cfg);

    // JPEG encode with quality 88
    let file = std::fs::File::create(&args.output)
        .map_err(|e| format!("Cannot create output file '{}': {e}", args.output))?;
    let writer = BufWriter::new(file);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(writer, 88);
    encoder
        .write_image(
            grid.as_raw(),
            grid_w,
            grid_h,
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG encoding failed: {e}"))?;

    let abs_path = std::fs::canonicalize(&args.output)
        .unwrap_or_else(|_| std::path::PathBuf::from(&args.output));
    println!("DONE {}", abs_path.display());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path(name: &str) -> String {
        std::env::temp_dir()
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    fn default_args(output: String) -> PreviewArgs {
        PreviewArgs {
            output,
            color_theme: "classic".to_string(),
            font_path: None,
            branding_enabled: true,
            branding_text: "Test Branding".to_string(),
            video_info_enabled: true,
            show_file_size: true,
            show_resolution_fps: true,
            show_video_encoding: true,
            show_audio_encoding: true,
            show_duration: true,
            show_frame_timestamp: false,
            rows: 2,
            cols: 3,
            lang: "en".to_string(),
        }
    }

    #[test]
    fn preview_creates_valid_jpeg() {
        let out = tmp_path("jr_test_preview_valid.jpg");
        run_preview(default_args(out.clone())).expect("preview should succeed");

        let bytes = std::fs::read(&out).expect("output file should exist");
        // JPEG magic bytes: FF D8 FF
        assert_eq!(&bytes[..3], &[0xFF, 0xD8, 0xFF], "output must be a valid JPEG");
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn preview_correct_dimensions_with_header() {
        let out = tmp_path("jr_test_preview_dims.jpg");
        run_preview(default_args(out.clone())).expect("preview should succeed");

        let img = image::open(&out).expect("should open as image");
        // 3 cols × 400 px wide (1200 / 3 = 400)
        assert_eq!(img.width(), 1200, "width should be 3 × 400");
        // 2 rows × 225 + HEADER_H
        assert_eq!(img.height(), 2 * 225 + crate::text_renderer::HEADER_H, "height should be 2 × 225 + HEADER_H");
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn preview_no_overlay_omits_header() {
        let out = tmp_path("jr_test_preview_nooverlay.jpg");
        run_preview(PreviewArgs {
            output: out.clone(),
            color_theme: "dark".to_string(),
            font_path: None,
            branding_enabled: false,
            branding_text: String::new(),
            video_info_enabled: false,
            show_file_size: false,
            show_resolution_fps: false,
            show_video_encoding: false,
            show_audio_encoding: false,
            show_duration: false,
            show_frame_timestamp: false,
            rows: 2,
            cols: 3,
            lang: "en".to_string(),
        })
        .expect("preview should succeed without overlay");

        let img = image::open(&out).expect("should open as image");
        // No header: exactly 2 rows × 225 = 450
        assert_eq!(img.height(), 450, "height should be 2 × 225 (no header)");
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn preview_all_themes_produce_valid_jpeg() {
        for theme in ["classic", "dark", "light", "cinematic", "minimal"] {
            let out = tmp_path(&format!("jr_test_preview_{theme}.jpg"));
            let mut args = default_args(out.clone());
            args.color_theme = theme.to_string();
            args.show_frame_timestamp = true;

            run_preview(args).unwrap_or_else(|e| panic!("preview theme={theme} failed: {e}"));

            let bytes = std::fs::read(&out).expect("file should exist");
            assert_eq!(&bytes[..3], &[0xFF, 0xD8, 0xFF], "theme={theme}: not a JPEG");
            assert!(bytes.len() > 1024, "theme={theme}: file suspiciously small");
            let _ = std::fs::remove_file(&out);
        }
    }

    #[test]
    fn preview_output_file_is_nonempty() {
        let out = tmp_path("jr_test_preview_size.jpg");
        run_preview(default_args(out.clone())).expect("preview should succeed");

        let meta = std::fs::metadata(&out).expect("file should exist");
        assert!(meta.len() > 4096, "JPEG should be at least 4 KB");
        let _ = std::fs::remove_file(&out);
    }
}
