# Implementation Plan: Video Thumbnail Sheet Generator

**Branch**: `003-poster-sheet-generator` | **Date**: 2026-05-14 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/003-poster-sheet-generator/spec.md`

## Summary

Implement an MPC-style video thumbnail sheet generator as a hidden easter egg feature in the Jellyfin Recents plugin. A new Rust binary (`poster-gen`) extracts frames by calling Jellyfin's bundled ffmpeg executable as a subprocess, stitches them into a configurable grid image, and burns overlay text (timestamps, video metadata, branding label) using `cosmic-text` with a dynamically-acquired Noto Sans CJK font. The C# plugin exposes a job-based REST API for async generation with real-time progress polling. The frontend unlocks the feature via a 7-click easter egg on the poster-view toolbar button.

## Technical Context

**Language/Version**:
- Rust (new): stable 1.78+ — `poster-gen` binary
- C# 10 / .NET 8 (existing) — plugin shell, job API
- TypeScript / Preact (existing) — frontend overlay + easter egg

**Primary Dependencies**:
- Rust: `image` (grid stitching, JPEG encode), `cosmic-text` v0.19 (text layout + CJK rendering), `rayon` (parallel ffmpeg subprocess calls), `serde_json` (stdout MediaInfo), `sha2` (overlay hash + cache key)
- C#: `System.Diagnostics.Process` (spawn Rust binary), `IMediaEncoder` (ffmpeg path), `IHostedService` (job lifecycle), existing Jellyfin plugin infrastructure
- TypeScript: `zod` (grid constraint validation schema), existing Preact/Vite stack

**Storage**:
- Filesystem: `{pluginDataDir}/poster-cache/*.jpg` (generated sheets), `{pluginDataDir}/fonts/NotoSansJP.ttf` (downloaded font)
- `localStorage`: unlock state (`jr-poster-unlocked`), poster settings (`jr-poster-*`)
- In-memory: `ConcurrentDictionary<string, PosterSheetJob>` (job state, not persisted)

**Testing**:
- Rust: `cargo test` — unit tests for frame timestamp calculation, grid layout math, cache key generation, short-video preset validation
- C#: xUnit — `PosterSheetJobService` unit tests (job lifecycle, cancellation, progress update), API endpoint integration tests
- TypeScript: Vitest — easter egg click counter (timing window, reset logic), Zod schema validation for grid constraints

**Target Platform**:
- Rust binary: Linux x64 (primary — Jellyfin Docker), Windows x64 (secondary)
- Frontend: Chrome/modern browser (existing)

**Performance Goals**:
- SC-001: 1080p, 6×8 grid → ≤ 30 s
- SC-002: 4K, 6×8 grid → ≤ 90 s (ffmpeg internal scale filter reduces decode cost)
- SC-004: Cache hit → ≤ 1 s
- SC-005: Memory spike ≤ 500 MB above baseline (ffmpeg subprocesses are isolated; each decodes one frame at reduced resolution)

**Constraints**:
- Rust binary must not link against any library not present in Jellyfin's Docker image; it calls ffmpeg via subprocess (no dynamic linking to libav*)
- Font acquired dynamically; binary must work without font (render ASCII fallback, log warning) if download fails
- Plugin ZIP size increase: ~10–24 MB (two platform binaries + no bundled font)

**Scale/Scope**: Single-user plugin, concurrent job limit = 1 per item, no global queue limit in v1.

## Constitution Check

No project constitution has been defined (`.specify/memory/constitution.md` is an unfilled template). No gates to evaluate. Proceeding without constraints.

## Project Structure

### Documentation (this feature)

```text
specs/003-poster-sheet-generator/
├── plan.md          ← this file
├── research.md      ← Phase 0 output
├── data-model.md    ← Phase 1 output
├── spec.md
├── contracts/
│   └── api.md       ← Phase 1 output
└── tasks.md         ← Phase 2 output (/speckit-tasks)
```

### Source Code

```text
src/
├── JellyfinRecents.Plugin/
│   ├── Api/
│   │   └── PosterSheetController.cs          (new) — 5 REST endpoints
│   ├── Services/
│   │   ├── PosterSheetJobService.cs           (new) — IHostedService, job dict
│   │   └── FontAcquisitionService.cs          (new) — download/verify Noto Sans JP & Noto Serif JP
│   └── Models/
│       ├── PosterSheetJob.cs                  (new) — in-memory job record
│       ├── PosterSheetRequestDto.cs           (new)
│       ├── PosterSheetStatusDto.cs            (new)
│       └── MediaInfoDto.cs                    (new)
│
├── poster-gen/                                (new Rust crate)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                            — CLI arg parsing, orchestration
│       ├── frame_extractor.rs                 — ffmpeg subprocess, parallel seeks
│       ├── image_stitcher.rs                  — grid assembly, per-frame timestamps
│       ├── text_renderer.rs                   — cosmic-text overlay rendering
│       ├── font_manager.rs                    — font loading from path arg
│       ├── media_info.rs                      — ffprobe call → MediaInfo JSON
│       └── preview.rs                         — preview subcommand: placeholder grid + theme rendering
│
└── frontend/src/
    ├── components/
    │   ├── PosterSheetOverlay.tsx             (new) — progress + result overlay
    │   └── PosterSheetSettingsPanel.tsx       (new) — rows/cols/mode/overlay config
    ├── api/
    │   └── posterSheetApi.ts                  (new) — typed fetch wrappers
    └── state/
        └── posterSheetUnlock.ts               (new) — 7-click easter egg counter
```

**Modified files**:
- `src/JellyfinRecents.Plugin/Api/HistoryController.cs` — add `videoDuration` to `PlayRecord` response
- `src/frontend/src/components/App.tsx` — attach easter egg counter to poster-view toolbar button; add `title="Click me 7 times"`
- `src/frontend/src/components/PlayRecordCard.tsx` — add unified card toolbar (folder icon + poster sheet button)
- `src/frontend/src/types.ts` — add `videoDuration` to `PlayRecord` type
- `src/JellyfinRecents.Plugin/Plugin.cs` — register `PosterSheetJobService`, `FontAcquisitionService`
- `src/JellyfinRecents.Plugin/JellyfinRecents.Plugin.csproj` — add `poster-gen` binary to Release output

## Key Implementation Notes

### Easter Egg Activation (Frontend)

```typescript
// posterSheetUnlock.ts
const REQUIRED_CLICKS = 7
const WINDOW_MS = 5000

let clicks = 0
let timer: ReturnType<typeof setTimeout> | null = null

export function registerPosterViewClick(): boolean {
  clicks++
  if (timer) clearTimeout(timer)
  if (clicks >= REQUIRED_CLICKS) {
    clicks = 0
    localStorage.setItem('jr-poster-unlocked', '1')
    return true // unlocked
  }
  timer = setTimeout(() => { clicks = 0 }, WINDOW_MS)
  return false
}

export function isPosterUnlocked(): boolean {
  return localStorage.getItem('jr-poster-unlocked') === '1'
}
```

The poster-view button (`海报视图`) receives `title="Click me 7 times"` and calls `registerPosterViewClick()` on each click in addition to its normal view-switch behaviour.

### Short-Video Grid Validation (Frontend, Zod)

```typescript
const gridSchema = (durationSeconds: number) =>
  z.object({
    rows: z.int().min(1).max(10),
    cols: z.int().min(1).max(12),
  }).refine(({ rows, cols }) => {
    const frames = rows * cols
    const minSpacingSec = 2
    return durationSeconds / frames >= minSpacingSec
  }, { message: `Grid too dense for ${durationSeconds}s video (min 2s/frame)` })
```

For videos under 2 minutes: only preset combos satisfying the above are shown; free input is disabled.

### Rust Binary stdout Protocol

```
PROGRESS {n}/{total}\n          — emitted after each frame captured
MEDIA_INFO {json}\n             — emitted once before DONE (after ffprobe completes)
DONE {output_path}\n            — final line on success
ERROR {message}\n               — on failure (exit code 1)
```

C# reads lines with `StandardOutput.ReadLineAsync()` in a loop, switching on prefix.

### Font Acquisition

On plugin startup, `FontAcquisitionService` runs asynchronously and independently for each font slot:

**Per slot** (Noto Sans JP and Noto Serif JP, independently):
1. Check `{dataDir}/fonts/custom-font-sans.ttf` / `custom-font-serif.ttf` → use if present (manual override)
2. Check `{dataDir}/fonts/NotoSansJP.ttf` / `NotoSerifJP.ttf` + SHA-256 checksum file → use if valid
3. Download from respective Google Fonts URL, verify SHA-256, write checksum file
4. On failure: log warning, set `NotoSansPath = null` / `NotoSerifPath = null`

**Selection at generation time** (`PosterSheetJobService`):
- Use path corresponding to `OverlaySettings.FontFamily`
- If selected font path is null, fall back to the other available font and log a notice
- If both paths are null, pass no `--font-path` flag; `poster-gen` uses built-in bitmap ASCII fallback

### Cross-Platform Binary Selection (C#)

```csharp
var binaryName = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
    ? "poster-gen-win-x64.exe"
    : "poster-gen-linux-x64";
var binaryPath = Path.Combine(
    Path.GetDirectoryName(GetType().Assembly.Location)!, binaryName);

// Linux: ensure executable bit
if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
    File.SetUnixFileMode(binaryPath,
        UnixFileMode.UserRead | UnixFileMode.UserExecute |
        UnixFileMode.GroupRead | UnixFileMode.GroupExecute);
```

## Complexity Tracking

*No constitution violations. Section not applicable.*
