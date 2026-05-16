# Research: Video Thumbnail Sheet Generator

**Branch**: `003-poster-sheet-generator` | **Date**: 2026-05-14

---

## Decision 1: Video Frame Extraction Strategy

**Decision**: Use Jellyfin's bundled **ffmpeg executable** as a subprocess, not `ffmpeg-next` library bindings.

**Rationale**:
- Jellyfin ships its own `jellyfin-ffmpeg` package on all supported platforms. On the official Docker image, the executable is at `/usr/lib/jellyfin-ffmpeg/ffmpeg`; on Windows installs it is at a platform-specific path. Jellyfin exposes this path through its `IMediaEncoder` service, which the plugin already has access to.
- Using the executable avoids all dynamic library linking complexity (`LD_LIBRARY_PATH`, `PKG_CONFIG_PATH`, multi-stage Dockerfile). The Rust binary simply receives `--ffmpeg-path` as a CLI argument and calls `std::process::Command`.
- Overhead of ~48 subprocess calls for a 6×8 grid is acceptable: each `ffmpeg -ss {ts} -i {file} -frames:v 1 -vf scale=320:-1 -f rawvideo pipe:1` call takes ~50–300 ms; total subprocess overhead ~2–5 s, well within the 30–90 s budget.
- Parallel extraction: spawn N ffmpeg processes concurrently (via `rayon` or `tokio::process`) — each is independent and stateless, so parallelism is trivially safe.

**Alternatives considered**:
- `ffmpeg-next` v8.1 (Rust bindings): More efficient per-frame seeking but requires dynamic linking against `/usr/lib/jellyfin-ffmpeg/lib/`, needs `LD_LIBRARY_PATH` set at runtime, and complicates CI cross-compilation. Rejected for this feature; viable if subprocess overhead becomes a bottleneck in future.
- `video-rs`: Wrapper around `ffmpeg-next`, still work-in-progress, seeking API incomplete. Rejected.

**Key implementation detail**: Seeking strategy — `ffmpeg -ss {ts}` placed **before** `-i` triggers input seeking (fast, keyframe-level), then `-frames:v 1` captures the first decoded frame after that keyframe. This is equivalent to `AVSEEK_FLAG_BACKWARD` and avoids full GOP decode.

---

## Decision 2: Rust Binary Distribution

**Decision**: Bundle both platform binaries (`poster-gen-linux-x64`, `poster-gen-win-x64.exe`) directly inside the plugin ZIP.

**Rationale**:
- Jellyfin plugin ZIPs can contain arbitrary files; the server extracts them to `/config/plugins/JellyfinRecents_<version>/`. The C# plugin locates sibling binaries via `Path.Combine(Path.GetDirectoryName(Assembly.Location)!, binaryName)`.
- Linux: ZIP extraction does not preserve Unix execute permissions. The plugin's `OnLoaded()` or equivalent startup hook must call `File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserExecute)` (.NET 7+).
- Platform selection at runtime: `RuntimeInformation.IsOSPlatform(OSPlatform.Windows)` → `poster-gen-win-x64.exe`, else `poster-gen-linux-x64`.
- Binary size estimate: Rust release binary with `cosmic-text` + `image` + no ffmpeg linking ≈ 5–12 MB per platform. Acceptable plugin ZIP increase.

**Alternatives considered**:
- Separate GitHub Release asset: Poor UX (users must manually install). Rejected.
- Dynamic download on first use (like font): Rejected — binary is part of core functionality, not optional; download failure would break the feature entirely.

---

## Decision 3: CJK Font

**Decision**: **Noto Sans JP variable font** (`NotoSansJP[wght].ttf`, ~9.4 MB, Apache 2.0).

**Download URL** (stable GitHub Releases):
```
https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf
```

**Rationale**:
- 9.4 MB for a single variable TTF file covering CJK Unified Ideographs (20,902+ chars), Hiragana, Katakana, Hangul, and full Latin. One file handles all CJK scripts.
- Apache 2.0 license — no copyleft, no attribution required in binary distribution.
- Stable URL from Google's fonts repository (not a release tag that expires).
- Integrity verified via SHA-256 checksum stored in plugin data directory alongside the font file.

**Acquisition flow**:
1. Plugin startup: check `{dataDir}/fonts/NotoSansJP.ttf` exists and checksum matches.
2. If not: download, verify checksum; on failure write error to Jellyfin log and surface actionable message.
3. Manual fallback: user may place any TTF/OTF named `custom-font.ttf` in `{dataDir}/fonts/`; plugin prefers this over the downloaded font.

**Alternatives considered**:
- LXGW WenKai (~25 MB, SIL OFL): Beautiful but large, covers only Simplified Chinese. Rejected.
- WenQuanYi Micro Hei (~5 MB): No stable download URL from official releases. Rejected.
- Source Han Sans (SIL OFL): Same glyph source as Noto, larger multi-weight packages. Rejected.

---

## Decision 4: Rust Text Rendering

**Decision**: **`cosmic-text`** v0.19 + **`image`** crate.

**Rationale**:
- `cosmic-text` (pop-os, v0.19.0 released 2026-04) is the only actively maintained pure-CPU Rust text layout library with full Unicode shaping (via `rustybuzz`, a HarfBuzz port), bidirectional text, and font fallback. Tested against UDHR in ~500 languages.
- No GPU or windowing dependency. Loads TTF/OTF from file. Outputs rasterised glyph bitmaps that can be blitted onto an `image::RgbImage` buffer.
- `image` crate handles frame buffer assembly, JPEG encoding, and grid stitching.

**Alternatives considered**:
- `ab_glyph` + `imageproc`: No shaping support; CJK glyphs render correctly for simple text but complex combinations may fail. In maintenance mode. Rejected.
- `fontdue`: Fast rasteriser but no shaping. Rejected.
- `rusttype`: Deprecated. Rejected.

---

## Decision 5: C# Job Management

**Decision**: In-memory `ConcurrentDictionary<string, PosterSheetJob>` hosted in an `IHostedService`, backed by `Task.Run` for background execution. No SQLite for job state.

**Rationale**:
- Job state is ephemeral: if the server restarts, the user re-triggers generation. The output file (JPEG) is the persistent artifact.
- `GetOrAdd` on the dictionary with `itemId` as key ensures idempotent job creation — a second request for the same item attaches to the existing job.
- Cancellation via `CancellationTokenSource` stored in `PosterSheetJob`; calling `.Cancel()` signals the Rust subprocess to terminate (via process kill).
- Progress updates: Rust subprocess writes `PROGRESS {n}/{total}` lines to stdout; C# reads asynchronously with `RedirectStandardOutput` and updates `PosterSheetJob.Progress` via `Interlocked.Exchange`.

**Alternatives considered**:
- `System.Threading.Channels`: Appropriate for pipeline/streaming scenarios; overkill for coarse-grained per-item jobs. Rejected.
- SQLite job persistence: Unnecessary complexity; jobs are not user-visible across restarts. Rejected.

---

## Decision 6: Cache Key and Storage

**Decision**: Cache files use a deterministic filename derived from job parameters; lookup is a filesystem `File.Exists` check — no additional database table.

**Filename format**:
```
{dataDir}/poster-cache/{itemId}_{rows}x{cols}_{seed}_{overlayHash}.jpg
```
where `overlayHash` is a short (8-char) SHA-256 of the serialised `OverlaySettings`.

**Rationale**: Simple, requires no index table. Cache is append-only in v1 (no eviction). A future cleanup task (feature 002) or a manual "Clear Cache" UI button can enumerate and delete stale files.
