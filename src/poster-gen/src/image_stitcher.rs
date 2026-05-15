// Grid assembly and JPEG encoding

use image::{DynamicImage, ImageEncoder, RgbImage, imageops};
use std::io::BufWriter;

pub struct StitchConfig {
    pub rows: u32,
    pub cols: u32,
    pub cell_width: u32,
    /// Computed from first frame aspect ratio
    pub cell_height: u32,
}

pub fn stitch_grid(
    frames: Vec<(DynamicImage, f64)>,
    config: &StitchConfig,
    output_path: &str,
    overlay_cfg: &crate::text_renderer::OverlayConfig,
    media_info: &crate::media_info::MediaInfo,
) -> Result<(), String> {
    if frames.is_empty() {
        return Err("No frames to stitch".to_string());
    }

    // Determine cell_height from first frame's actual dimensions
    let first_rgb = frames[0].0.to_rgb8();
    let actual_h = first_rgb.height();
    let actual_w = first_rgb.width();

    // Scale cell_height proportionally to cell_width
    let cell_height = if actual_w > 0 {
        (config.cell_width as f64 * actual_h as f64 / actual_w as f64).round() as u32
    } else {
        config.cell_height
    };
    let cell_height = if cell_height == 0 { config.cell_height } else { cell_height };

    // Account for header bar height in total image height
    let header_h: u32 = if overlay_cfg.video_info_enabled || overlay_cfg.branding_enabled {
        crate::text_renderer::HEADER_H
    } else {
        0
    };

    let grid_w = config.cols * config.cell_width;
    let grid_h = config.rows * cell_height + header_h;

    let mut grid = RgbImage::new(grid_w, grid_h);

    // Fill background black
    for pixel in grid.pixels_mut() {
        *pixel = image::Rgb([0u8, 0, 0]);
    }

    // Place each frame into the grid
    for (idx, (frame, _ts)) in frames.iter().enumerate() {
        let row = (idx as u32) / config.cols;
        let col = (idx as u32) % config.cols;

        if row >= config.rows {
            break;
        }

        let cx = col * config.cell_width;
        let cy = row * cell_height + header_h;

        // Resize frame to fit cell exactly
        let resized = frame.resize_exact(
            config.cell_width,
            cell_height,
            imageops::FilterType::Lanczos3,
        );
        let rgb_frame = resized.to_rgb8();

        imageops::overlay(&mut grid, &rgb_frame, cx as i64, cy as i64);
    }

    // Build overlay config with resolved cell_height
    let resolved_overlay = crate::text_renderer::OverlayConfig {
        branding_enabled: overlay_cfg.branding_enabled,
        branding_text: overlay_cfg.branding_text.clone(),
        video_info_enabled: overlay_cfg.video_info_enabled,
        show_file_size: overlay_cfg.show_file_size,
        show_resolution_fps: overlay_cfg.show_resolution_fps,
        show_video_encoding: overlay_cfg.show_video_encoding,
        show_audio_encoding: overlay_cfg.show_audio_encoding,
        show_duration: overlay_cfg.show_duration,
        show_frame_timestamp: overlay_cfg.show_frame_timestamp,
        color_theme: overlay_cfg.color_theme.clone(),
        font_path: overlay_cfg.font_path.clone(),
        lang: overlay_cfg.lang.clone(),
        frame_timestamps: overlay_cfg.frame_timestamps.clone(),
        rows: config.rows,
        cols: config.cols,
        cell_width: config.cell_width,
        cell_height,
    };

    // Render overlay (branding, info, per-frame badges)
    crate::text_renderer::render_overlay(&mut grid, media_info, &resolved_overlay);

    // JPEG encode with quality 88
    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("Cannot create output file '{output_path}': {e}"))?;
    let writer = BufWriter::new(file);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(writer, 88);
    encoder
        .write_image(grid.as_raw(), grid_w, grid_h, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encoding failed: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::DynamicImage;

    fn tmp_path(name: &str) -> String {
        std::env::temp_dir()
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    fn blank_frame(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(image::RgbImage::new(w, h))
    }

    fn dummy_media_info() -> crate::media_info::MediaInfo {
        crate::media_info::MediaInfo {
            filename: "test.mkv".to_string(),
            file_size: "1 GB".to_string(),
            file_size_bytes: 1_073_741_824,
            resolution: "1280\u{d7}720".to_string(),
            fps: 24.0,
            video_codec: "H.264".to_string(),
            bit_depth: None,
            hdr_type: None,
            colour_space: None,
            audio_codec: Some("AAC".to_string()),
            audio_format: Some("stereo".to_string()),
            audio_bitrate: Some("128 kbps".to_string()),
            audio_sample_rate: Some(48000),
            audio_tracks: 1,
            duration: "00:30:00".to_string(),
            duration_secs: 1800.0,
        }
    }

    fn dummy_overlay(
        rows: u32,
        cols: u32,
        cell_w: u32,
        cell_h: u32,
        enabled: bool,
    ) -> crate::text_renderer::OverlayConfig {
        crate::text_renderer::OverlayConfig {
            branding_enabled: enabled,
            branding_text: "Test".to_string(),
            video_info_enabled: enabled,
            show_file_size: false,
            show_resolution_fps: false,
            show_video_encoding: false,
            show_audio_encoding: false,
            show_duration: false,
            show_frame_timestamp: false,
            color_theme: "classic".to_string(),
            font_path: None,
            lang: "en".to_string(),
            frame_timestamps: (0..rows * cols).map(|i| i as f64 * 10.0).collect(),
            rows,
            cols,
            cell_width: cell_w,
            cell_height: cell_h,
        }
    }

    #[test]
    fn stitch_produces_valid_jpeg() {
        let out = tmp_path("jr_test_stitch_valid.jpg");
        let (cell_w, cell_h, rows, cols) = (320u32, 180u32, 2u32, 3u32);
        let frames: Vec<(DynamicImage, f64)> = (0..rows * cols)
            .map(|i| (blank_frame(cell_w, cell_h), i as f64 * 10.0))
            .collect();

        stitch_grid(
            frames,
            &StitchConfig { rows, cols, cell_width: cell_w, cell_height: cell_h },
            &out,
            &dummy_overlay(rows, cols, cell_w, cell_h, true),
            &dummy_media_info(),
        )
        .expect("stitch should succeed");

        let bytes = std::fs::read(&out).expect("output file should exist");
        assert_eq!(&bytes[..3], &[0xFF, 0xD8, 0xFF], "output must be valid JPEG");
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn stitch_correct_dimensions_with_header() {
        let out = tmp_path("jr_test_stitch_dims.jpg");
        let (cell_w, cell_h, rows, cols) = (320u32, 180u32, 2u32, 3u32);
        let frames: Vec<(DynamicImage, f64)> = (0..rows * cols)
            .map(|i| (blank_frame(cell_w, cell_h), i as f64))
            .collect();

        stitch_grid(
            frames,
            &StitchConfig { rows, cols, cell_width: cell_w, cell_height: cell_h },
            &out,
            &dummy_overlay(rows, cols, cell_w, cell_h, true),
            &dummy_media_info(),
        )
        .expect("stitch should succeed");

        let img = image::open(&out).expect("should decode");
        assert_eq!(img.width(), cols * cell_w, "width = cols × cell_w");
        // Blank frames are 0×0 → cell_height falls back to config value; header = HEADER_H
        assert_eq!(
            img.height(),
            rows * cell_h + crate::text_renderer::HEADER_H,
            "height = rows × cell_h + HEADER_H-px header"
        );
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn stitch_no_overlay_no_header() {
        let out = tmp_path("jr_test_stitch_nooverlay.jpg");
        let (cell_w, cell_h, rows, cols) = (320u32, 180u32, 2u32, 2u32);
        let frames: Vec<(DynamicImage, f64)> = (0..rows * cols)
            .map(|i| (blank_frame(cell_w, cell_h), i as f64))
            .collect();

        stitch_grid(
            frames,
            &StitchConfig { rows, cols, cell_width: cell_w, cell_height: cell_h },
            &out,
            &dummy_overlay(rows, cols, cell_w, cell_h, false),
            &dummy_media_info(),
        )
        .expect("stitch without overlay should succeed");

        let img = image::open(&out).expect("should decode");
        assert_eq!(img.height(), rows * cell_h, "no header when overlay disabled");
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn stitch_empty_frames_returns_error() {
        let out = tmp_path("jr_test_stitch_empty.jpg");
        let result = stitch_grid(
            vec![],
            &StitchConfig { rows: 2, cols: 3, cell_width: 320, cell_height: 180 },
            &out,
            &dummy_overlay(2, 3, 320, 180, false),
            &dummy_media_info(),
        );
        assert!(result.is_err(), "empty frame list should return Err");
    }

    #[test]
    fn stitch_single_frame_1x1() {
        let out = tmp_path("jr_test_stitch_1x1.jpg");
        let (cell_w, cell_h) = (320u32, 180u32);
        let frames = vec![(blank_frame(cell_w, cell_h), 0.0)];

        stitch_grid(
            frames,
            &StitchConfig { rows: 1, cols: 1, cell_width: cell_w, cell_height: cell_h },
            &out,
            &dummy_overlay(1, 1, cell_w, cell_h, false),
            &dummy_media_info(),
        )
        .expect("1×1 stitch should succeed");

        let img = image::open(&out).expect("should decode");
        assert_eq!(img.width(), cell_w);
        assert_eq!(img.height(), cell_h);
        let _ = std::fs::remove_file(&out);
    }
}
