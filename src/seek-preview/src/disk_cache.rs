use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CACHE_DIR: &str = "/tmp/seek-preview";
const INDEX_FILE: &str = "/tmp/seek-preview/index.txt";
pub const CAP_BYTES: u64 = 512 * 1024 * 1024; // 512 MB
const TRIM_RATIO: f64 = 0.75;

// ── index ────────────────────────────────────────────────────────────────────

struct Entry {
    size: u64,
    written_at: u64,
    video_mtime: u64,
}

#[derive(Default)]
struct Index {
    entries: HashMap<(String, i64), Entry>, // (item_id, aligned_ms) → entry
    total_bytes: u64,
}

// ── public interface ─────────────────────────────────────────────────────────

pub struct DiskCache {
    index: Mutex<Index>,
}

impl DiskCache {
    pub fn new() -> Arc<Self> {
        let _ = std::fs::create_dir_all(CACHE_DIR);
        sweep_legacy_dirs();
        let index = load_index().unwrap_or_else(|_| rebuild_index());
        eprintln!(
            "[seek-preview] disk cache: {:.1} MB used / {:.0} MB cap ({} entries)",
            index.total_bytes as f64 / 1e6,
            CAP_BYTES as f64 / 1e6,
            index.entries.len(),
        );
        Arc::new(Self { index: Mutex::new(index) })
    }

    /// Read a cached frame. Returns None if not cached or source video was replaced.
    pub fn read(&self, item_id: &str, video_path: &Path, aligned_ms: i64) -> Option<Vec<u8>> {
        let current_mtime = video_mtime(video_path);
        {
            let mut idx = self.index.lock().unwrap();
            match idx.entries.get(&(item_id.to_owned(), aligned_ms)) {
                None => return None,
                Some(e) if e.video_mtime != current_mtime => {
                    let stale: Vec<_> = idx.entries
                        .iter()
                        .filter(|(k, e)| k.0 == item_id && e.video_mtime != current_mtime)
                        .map(|(k, e)| (k.clone(), e.size))
                        .collect();
                    for (k, size) in stale {
                        idx.entries.remove(&k);
                        idx.total_bytes = idx.total_bytes.saturating_sub(size);
                        let _ = std::fs::remove_file(frame_path(&k.0, k.1));
                    }
                    return None;
                }
                _ => {}
            }
        }
        std::fs::read(frame_path(item_id, aligned_ms)).ok()
    }

    /// Check whether a frame is cached (index lookup only, no file I/O).
    pub fn exists(&self, item_id: &str, video_path: &Path, aligned_ms: i64) -> bool {
        let current_mtime = video_mtime(video_path);
        let idx = self.index.lock().unwrap();
        idx.entries.get(&(item_id.to_owned(), aligned_ms))
            .map(|e| e.video_mtime == current_mtime)
            .unwrap_or(false)
    }

    /// Write a frame to disk; updates index and triggers cleanup if over cap.
    pub fn write(&self, item_id: &str, video_path: &Path, aligned_ms: i64, data: &[u8]) {
        let p = frame_path(item_id, aligned_ms);

        {
            let idx = self.index.lock().unwrap();
            if idx.entries.contains_key(&(item_id.to_owned(), aligned_ms)) {
                return;
            }
        }

        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(&p, data).is_err() {
            return;
        }

        let size = data.len() as u64;
        let ts = now_secs();
        let vmtime = video_mtime(video_path);
        let over_cap = {
            let mut idx = self.index.lock().unwrap();
            idx.entries.insert((item_id.to_owned(), aligned_ms), Entry { size, written_at: ts, video_mtime: vmtime });
            idx.total_bytes += size;
            idx.total_bytes > CAP_BYTES
        };

        self.flush();

        if over_cap {
            self.cleanup();
        }
    }

    fn flush(&self) {
        let idx = self.index.lock().unwrap();
        let _ = write_index(&idx);
    }

    fn cleanup(&self) {
        let mut idx = self.index.lock().unwrap();
        let target = (CAP_BYTES as f64 * TRIM_RATIO) as u64;
        if idx.total_bytes <= target {
            return;
        }

        let mut entries: Vec<_> = idx.entries.keys().cloned().collect();
        entries.sort_unstable_by_key(|k| {
            idx.entries.get(k).map(|e| e.written_at).unwrap_or(0)
        });

        for key in entries {
            if idx.total_bytes <= target {
                break;
            }
            let p = frame_path(&key.0, key.1);
            if std::fs::remove_file(&p).is_ok() {
                if let Some(e) = idx.entries.remove(&key) {
                    idx.total_bytes = idx.total_bytes.saturating_sub(e.size);
                }
            }
        }

        if let Ok(dirs) = std::fs::read_dir(CACHE_DIR) {
            for entry in dirs.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    if std::fs::read_dir(&p).map(|mut d| d.next().is_none()).unwrap_or(false) {
                        let _ = std::fs::remove_dir(&p);
                    }
                }
            }
        }

        eprintln!(
            "[seek-preview] disk cache cleanup: {:.1} MB remaining ({} entries)",
            idx.total_bytes as f64 / 1e6,
            idx.entries.len(),
        );
        let _ = write_index(&idx);
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn frame_path(item_id: &str, aligned_ms: i64) -> PathBuf {
    PathBuf::from(CACHE_DIR).join(item_id).join(format!("{aligned_ms}.jpg"))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn video_mtime(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Remove directories left by the old path-hash scheme (16-char hex names).
/// Called once at startup before loading the index.
fn sweep_legacy_dirs() {
    let Ok(dirs) = std::fs::read_dir(CACHE_DIR) else { return };
    let mut found = false;
    for entry in dirs.flatten() {
        let name = entry.file_name();
        let s = name.to_string_lossy();
        if s.len() == 16 && s.chars().all(|c| c.is_ascii_hexdigit()) {
            let _ = std::fs::remove_dir_all(entry.path());
            eprintln!("[seek-preview] removed legacy cache dir: {s}");
            found = true;
        }
    }
    if found {
        // Stale index references deleted files; drop it so rebuild_index() runs fresh.
        let _ = std::fs::remove_file(INDEX_FILE);
    }
}

// ── index I/O ─────────────────────────────────────────────────────────────────
//
// Format (space-separated, one entry per line):
//   v1
//   total_bytes <N>
//   <item_id_32hex> <aligned_ms> <size_bytes> <unix_ts> <video_mtime>

fn write_index(idx: &Index) -> std::io::Result<()> {
    use std::fmt::Write as FmtWrite;
    let mut s = String::new();
    writeln!(s, "v1").unwrap();
    writeln!(s, "total_bytes {}", idx.total_bytes).unwrap();
    for ((item_id, ms), e) in &idx.entries {
        writeln!(s, "{} {} {} {} {}", item_id, ms, e.size, e.written_at, e.video_mtime).unwrap();
    }
    std::fs::write(INDEX_FILE, s)
}

fn load_index() -> Result<Index, Box<dyn std::error::Error>> {
    let text = std::fs::read_to_string(INDEX_FILE)?;
    let mut lines = text.lines();

    let version = lines.next().ok_or("empty index")?;
    if version != "v1" {
        return Err("unknown index version".into());
    }

    let total_line = lines.next().ok_or("missing total_bytes")?;
    let total_bytes: u64 = total_line.strip_prefix("total_bytes ").ok_or("bad header")?.parse()?;

    let mut entries = HashMap::new();
    for line in lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 { continue; }
        let item_id = parts[0].to_string();
        let ms: i64 = parts[1].parse()?;
        let size: u64 = parts[2].parse()?;
        let ts: u64 = parts[3].parse()?;
        let vmtime: u64 = parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0);
        if frame_path(&item_id, ms).exists() {
            entries.insert((item_id, ms), Entry { size, written_at: ts, video_mtime: vmtime });
        }
    }

    Ok(Index { entries, total_bytes })
}

fn rebuild_index() -> Index {
    let mut entries = HashMap::new();
    let mut total_bytes: u64 = 0;

    let Ok(dirs) = std::fs::read_dir(CACHE_DIR) else { return Index::default() };
    for dir in dirs.flatten() {
        let item_id = dir.file_name().to_string_lossy().to_string();
        if item_id == "index.txt" { continue; }
        let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
        for file in files.flatten() {
            let name = file.file_name();
            let stem = name.to_string_lossy();
            let ms: i64 = match stem.strip_suffix(".jpg").and_then(|s| s.parse().ok()) {
                Some(v) => v,
                None => continue,
            };
            let Ok(meta) = file.metadata() else { continue };
            let size = meta.len();
            let ts = meta.modified().ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            total_bytes += size;
            entries.insert((item_id.clone(), ms), Entry { size, written_at: ts, video_mtime: 0 });
        }
    }

    eprintln!("[seek-preview] rebuilt disk index: {:.1} MB ({} entries)", total_bytes as f64 / 1e6, entries.len());
    Index { entries, total_bytes }
}
