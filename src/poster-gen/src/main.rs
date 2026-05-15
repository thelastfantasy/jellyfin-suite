mod frame_extractor;
mod font_manager;
mod image_stitcher;
mod media_info;
mod preview;
mod text_renderer;

use clap::{Args, Parser, Subcommand};
use rayon::prelude::*;
use std::sync::{Arc, Mutex};

/// Jellyfin Recents poster sheet generator
#[derive(Parser, Debug)]
#[command(name = "poster-gen", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Flatten generate args at top level (default subcommand)
    #[command(flatten)]
    generate: GenerateArgs,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Generate a poster sheet from a video file (default)
    Generate(GenerateArgs),
    /// Fast preview without ffmpeg
    Preview(PreviewArgs),
}

#[derive(Args, Debug, Clone, Default)]
struct GenerateArgs {
    /// Path to ffmpeg executable
    #[arg(long, default_value = "ffmpeg")]
    ffmpeg_path: String,

    /// Input video file
    #[arg(long)]
    input: Option<String>,

    /// Output JPEG path
    #[arg(long)]
    output: Option<String>,

    /// Number of rows (1-10)
    #[arg(long, default_value_t = 6)]
    rows: u32,

    /// Number of columns (1-12)
    #[arg(long, default_value_t = 8)]
    cols: u32,

    /// Hex seed string for random mode
    #[arg(long)]
    seed: Option<String>,

    /// Generation mode: deterministic (default) or random
    #[arg(long, default_value = "deterministic")]
    mode: String,

    /// Optional path to TTF font
    #[arg(long)]
    font_path: Option<String>,

    /// Thumbnail width in pixels
    #[arg(long, default_value_t = 320)]
    thumb_width: u32,

    /// Color theme: classic|dark|light|cinematic|minimal
    #[arg(long, default_value = "classic")]
    color_theme: String,

    /// Show per-frame HH:MM:SS badge
    #[arg(long)]
    show_timestamp: bool,

    /// Branding label
    #[arg(long, default_value = "Jellyfin Recents")]
    branding_text: String,

    /// Disable branding label
    #[arg(long)]
    no_branding: bool,

    /// Disable entire top-left info block
    #[arg(long)]
    no_video_info: bool,

    /// Disable file size display
    #[arg(long)]
    no_file_size: bool,

    /// Disable resolution and FPS display
    #[arg(long)]
    no_resolution_fps: bool,

    /// Disable video encoding info
    #[arg(long)]
    no_video_encoding: bool,

    /// Disable audio encoding info
    #[arg(long)]
    no_audio_encoding: bool,

    /// Disable duration display
    #[arg(long)]
    no_duration: bool,

    /// Overlay label language: en|zh|ja
    #[arg(long, default_value = "en")]
    lang: String,
}

#[derive(Args, Debug, Clone, Default)]
struct PreviewArgs {
    /// Output JPEG path
    #[arg(long, default_value = "preview.jpg")]
    output: String,

    /// Color theme: classic|dark|light|cinematic|minimal
    #[arg(long, default_value = "classic")]
    color_theme: String,

    /// Optional path to TTF font
    #[arg(long)]
    font_path: Option<String>,

    /// Branding label
    #[arg(long, default_value = "Jellyfin Recents")]
    branding_text: String,

    /// Disable branding label
    #[arg(long)]
    no_branding: bool,

    /// Disable entire top-left info block
    #[arg(long)]
    no_video_info: bool,

    /// Disable file size display
    #[arg(long)]
    no_file_size: bool,

    /// Disable resolution and FPS display
    #[arg(long)]
    no_resolution_fps: bool,

    /// Disable video encoding info
    #[arg(long)]
    no_video_encoding: bool,

    /// Disable audio encoding info
    #[arg(long)]
    no_audio_encoding: bool,

    /// Disable duration display
    #[arg(long)]
    no_duration: bool,

    /// Show per-frame HH:MM:SS badge
    #[arg(long)]
    show_timestamp: bool,

    /// Number of rows (1-10)
    #[arg(long, default_value_t = 3)]
    rows: u32,

    /// Number of columns (1-12)
    #[arg(long, default_value_t = 2)]
    cols: u32,

    /// Overlay label language: en|zh|ja
    #[arg(long, default_value = "en")]
    lang: String,
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Some(Commands::Generate(args)) => run_generate(args),
        Some(Commands::Preview(args)) => run_preview_cmd(args),
        None => {
            // Default: run generate with top-level args
            run_generate(cli.generate)
        }
    };

    if let Err(msg) = result {
        eprintln!("ERROR {msg}");
        std::process::exit(1);
    }
}

/// Evenly-spaced frame timestamps centred within each interval.
/// Returns `total` values in `[spacing/2, duration - spacing/2]`.
pub fn even_timestamps(duration: f64, total: usize) -> Vec<f64> {
    let spacing = duration / total as f64;
    (0..total)
        .map(|i| spacing / 2.0 + i as f64 * spacing)
        .collect()
}

pub fn jittered_timestamps(duration: f64, total: usize, seed_hex: &str) -> Vec<f64> {
    let even = even_timestamps(duration, total);
    let spacing = duration / total as f64;
    let max_jitter = (spacing / 4.0).min((spacing - 2.0) / 2.0).max(0.0);
    if max_jitter == 0.0 {
        return even;
    }
    let seed = parse_seed_u64(seed_hex);
    even.iter().enumerate().map(|(i, &t)| {
        let r = xorshift64_at(seed, i as u64);
        let normalized = (r >> 11) as f64 / (1u64 << 53) as f64;
        let jitter = (normalized - 0.5) * 2.0 * max_jitter;
        t + jitter
    }).collect()
}

fn parse_seed_u64(s: &str) -> u64 {
    let hex = s.chars().filter(|c| c.is_ascii_hexdigit()).take(16).collect::<String>();
    u64::from_str_radix(&hex, 16).unwrap_or(0xdeadbeef_cafebabe)
}

fn xorshift64_at(seed: u64, idx: u64) -> u64 {
    let mut state = seed ^ idx.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    state
}

fn run_generate(args: GenerateArgs) -> Result<(), String> {
    let input = args
        .input
        .as_deref()
        .ok_or("--input is required for generate")?
        .to_string();
    let output = args
        .output
        .as_deref()
        .ok_or("--output is required for generate")?
        .to_string();

    let rows = args.rows.clamp(1, 10);
    let cols = args.cols.clamp(1, 12);

    // Extract media info first (need duration)
    let media_info = media_info::extract_media_info(&args.ffmpeg_path, &input)
        .map_err(|e| format!("Media info extraction failed: {e}"))?;

    let duration = media_info.duration_secs;
    if duration <= 0.0 {
        return Err("Could not determine video duration".to_string());
    }

    let total = (rows * cols) as usize;
    let timestamps = if args.mode == "random" {
        jittered_timestamps(duration, total, args.seed.as_deref().unwrap_or(""))
    } else {
        even_timestamps(duration, total)
    };

    // Cap rayon parallelism to prevent OOM with large source frames
    let num_threads = if args.thumb_width >= 1920 { 2 } else if args.thumb_width >= 1280 { 3 } else { 4 };
    let _ = rayon::ThreadPoolBuilder::new().num_threads(num_threads).build_global();

    // Extract frames in parallel with progress reporting
    let counter = Arc::new(Mutex::new(0usize));
    let total_frames = total;

    let frame_results: Vec<(usize, Result<image::DynamicImage, String>)> = timestamps
        .par_iter()
        .enumerate()
        .map(|(idx, &ts)| {
            let result = frame_extractor::extract_frame(
                &args.ffmpeg_path,
                &input,
                ts,
                args.thumb_width,
            );

            // Increment counter and print progress
            let n = {
                let mut c = counter.lock().unwrap();
                *c += 1;
                *c
            };
            println!("PROGRESS {n}/{total_frames}");

            (idx, result)
        })
        .collect();

    // Check for errors and collect frames in order
    let mut frames: Vec<(image::DynamicImage, f64)> = Vec::with_capacity(total);
    {
        let mut sorted = frame_results;
        sorted.sort_by_key(|(idx, _)| *idx);
        for (idx, result) in sorted {
            match result {
                Ok(img) => frames.push((img, timestamps[idx])),
                Err(e) => {
                    // Non-fatal: use a blank frame placeholder
                    eprintln!("WARNING: frame {idx} failed: {e}");
                    let blank = image::DynamicImage::ImageRgb8(image::RgbImage::new(
                        args.thumb_width,
                        args.thumb_width * 9 / 16,
                    ));
                    frames.push((blank, timestamps[idx]));
                }
            }
        }
    }

    // Print MEDIA_INFO json
    let info_json = serde_json::to_string(&media_info)
        .map_err(|e| format!("Failed to serialize media info: {e}"))?;
    println!("MEDIA_INFO {info_json}");

    // Build overlay config
    let overlay_cfg = text_renderer::OverlayConfig {
        branding_enabled: !args.no_branding,
        branding_text: args.branding_text.clone(),
        video_info_enabled: !args.no_video_info,
        show_file_size: !args.no_file_size,
        show_resolution_fps: !args.no_resolution_fps,
        show_video_encoding: !args.no_video_encoding,
        show_audio_encoding: !args.no_audio_encoding,
        show_duration: !args.no_duration,
        show_frame_timestamp: args.show_timestamp,
        color_theme: args.color_theme.clone(),
        font_path: args.font_path.clone(),
        lang: args.lang.clone(),
        frame_timestamps: timestamps.clone(),
        rows,
        cols,
        cell_width: args.thumb_width,
        cell_height: args.thumb_width * 9 / 16, // will be overridden by stitcher
    };

    let stitch_cfg = image_stitcher::StitchConfig {
        rows,
        cols,
        cell_width: args.thumb_width,
        cell_height: args.thumb_width * 9 / 16,
    };

    image_stitcher::stitch_grid(frames, &stitch_cfg, &output, &overlay_cfg, &media_info)
        .map_err(|e| format!("Stitching failed: {e}"))?;

    let abs_output = std::fs::canonicalize(&output)
        .unwrap_or_else(|_| std::path::PathBuf::from(&output));
    println!("DONE {}", abs_output.display());

    Ok(())
}

fn run_preview_cmd(args: PreviewArgs) -> Result<(), String> {
    let preview_args = preview::PreviewArgs {
        output: args.output,
        color_theme: args.color_theme,
        font_path: args.font_path,
        branding_enabled: !args.no_branding,
        branding_text: args.branding_text,
        video_info_enabled: !args.no_video_info,
        show_file_size: !args.no_file_size,
        show_resolution_fps: !args.no_resolution_fps,
        show_video_encoding: !args.no_video_encoding,
        show_audio_encoding: !args.no_audio_encoding,
        show_duration: !args.no_duration,
        show_frame_timestamp: args.show_timestamp,
        rows: args.rows,
        cols: args.cols,
        lang: args.lang,
    };

    preview::run_preview(preview_args)
}

#[cfg(test)]
mod tests {
    use super::{even_timestamps, jittered_timestamps};

    const EPS: f64 = 1e-9;

    #[test]
    fn even_spacing_count() {
        let ts = even_timestamps(3600.0, 48);
        assert_eq!(ts.len(), 48);
    }

    #[test]
    fn even_spacing_interval() {
        // 6×8=48 frames over 3600 s → spacing = 75 s
        let ts = even_timestamps(3600.0, 48);
        let spacing = 3600.0 / 48.0;
        assert!((ts[0] - spacing / 2.0).abs() < EPS);
        for i in 1..ts.len() {
            assert!((ts[i] - ts[i - 1] - spacing).abs() < EPS);
        }
    }

    #[test]
    fn even_spacing_first_last() {
        let ts = even_timestamps(3600.0, 48);
        let spacing = 3600.0 / 48.0;
        // first at spacing/2, last at duration - spacing/2
        assert!((ts[0] - spacing / 2.0).abs() < EPS);
        assert!((ts[47] - (3600.0 - spacing / 2.0)).abs() < EPS);
    }

    #[test]
    fn min_spacing_two_seconds() {
        // Minimum viable: 1 frame per 2 seconds
        let duration = 60.0;
        let total = 30; // exactly 2 s/frame
        let ts = even_timestamps(duration, total);
        for i in 1..ts.len() {
            assert!(ts[i] - ts[i - 1] >= 2.0 - EPS);
        }
    }

    #[test]
    fn single_frame() {
        let ts = even_timestamps(120.0, 1);
        assert_eq!(ts.len(), 1);
        assert!((ts[0] - 60.0).abs() < EPS);
    }

    #[test]
    fn all_timestamps_within_duration() {
        let duration = 3600.0;
        let ts = even_timestamps(duration, 48);
        for t in &ts {
            assert!(*t > 0.0, "timestamp must be positive, got {t}");
            assert!(*t < duration, "timestamp must be < duration, got {t}");
        }
    }

    #[test]
    fn two_frames_short_video() {
        // 10 s / 2 = 5 s spacing; first at 2.5 s, second at 7.5 s
        let ts = even_timestamps(10.0, 2);
        assert_eq!(ts.len(), 2);
        assert!((ts[0] - 2.5).abs() < EPS);
        assert!((ts[1] - 7.5).abs() < EPS);
    }

    #[test]
    fn large_grid_48_frames() {
        // 6×8 = 48 frames; a common production setting
        let ts = even_timestamps(5400.0, 48);
        assert_eq!(ts.len(), 48);
        let spacing = 5400.0 / 48.0;
        for i in 1..ts.len() {
            assert!(
                (ts[i] - ts[i - 1] - spacing).abs() < EPS,
                "frame {i} spacing off"
            );
        }
    }

    #[test]
    fn jitter_stays_within_bounds() {
        // spacing = 100 s → max_jitter = 25 s
        let ts = jittered_timestamps(1000.0, 10, "abc123");
        for t in &ts {
            assert!(*t > 0.0 && *t < 1000.0, "timestamp out of duration: {t}");
        }
        for w in ts.windows(2) {
            assert!(w[1] - w[0] >= 2.0 - EPS, "adjacent gap < 2s: {} {}", w[0], w[1]);
        }
    }

    #[test]
    fn jitter_differs_from_even() {
        let even = even_timestamps(1000.0, 10);
        let jittered = jittered_timestamps(1000.0, 10, "deadbeef");
        // At least one timestamp should differ meaningfully
        let any_diff = even.iter().zip(&jittered).any(|(a, b)| (a - b).abs() > 0.1);
        assert!(any_diff, "jittered timestamps should differ from even");
    }

    #[test]
    fn jitter_min_spacing_degrades_to_even() {
        // spacing = 2.0 → max_jitter = 0 → returns even timestamps
        let even = even_timestamps(20.0, 10);
        let jittered = jittered_timestamps(20.0, 10, "someseeed");
        for (a, b) in even.iter().zip(&jittered) {
            assert!((a - b).abs() < EPS, "should be even when spacing=2s");
        }
    }

    #[test]
    fn same_seed_deterministic() {
        let a = jittered_timestamps(3600.0, 48, "cafebabe12345678");
        let b = jittered_timestamps(3600.0, 48, "cafebabe12345678");
        for (x, y) in a.iter().zip(&b) {
            assert!((x - y).abs() < EPS, "same seed must produce same timestamps");
        }
    }

    #[test]
    fn different_seeds_produce_different_results() {
        let a = jittered_timestamps(3600.0, 48, "aaaa0000");
        let b = jittered_timestamps(3600.0, 48, "bbbb1111");
        let any_diff = a.iter().zip(&b).any(|(x, y)| (x - y).abs() > 0.1);
        assert!(any_diff, "different seeds should produce different timestamps");
    }
}
