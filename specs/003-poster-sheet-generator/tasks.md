# Tasks: Video Thumbnail Sheet Generator

**Branch**: `003-poster-sheet-generator` | **Input**: `specs/003-poster-sheet-generator/`  
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api.md, research.md

**Tests**: Included per plan.md Technical Context (Rust: `cargo test`, C#: xUnit, TypeScript: Vitest).

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no outstanding dependencies)
- **[Story]**: Which spec.md user story this task belongs to (US1–US6)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize new project components; no user story logic yet.

- [X] T001 Initialize Rust crate at `src/poster-gen/Cargo.toml` with all dependencies: `image`, `cosmic-text = "0.19"`, `rayon`, `serde_json`, `sha2`, `clap` (with derive feature)
- [X] T002 [P] Create C# model file stubs (namespace + empty class only) in `src/JellyfinRecents.Plugin/Models/`: `PosterSheetJob.cs`, `PosterSheetRequestDto.cs`, `PosterSheetStatusDto.cs`, `MediaInfoDto.cs`
- [X] T003 [P] Create empty Rust source files for the new modules: `src/poster-gen/src/frame_extractor.rs`, `media_info.rs`, `image_stitcher.rs`, `text_renderer.rs`, `font_manager.rs`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure and data-contract changes that MUST be complete before any user story work begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Extend `PlayRecord` response: add `videoDuration` field (`RunTimeTicks / 10_000_000`, `null` for audio-only) to `GET /JellyfinRecents/PlayHistory` in `src/JellyfinRecents.Plugin/Api/HistoryController.cs`
- [X] T005 [P] Add `videoDuration: number | null` field to `PlayRecord` TypeScript type in `src/frontend/src/types.ts`
- [X] T006 Fill in all C# model definitions per data-model.md: `PosterSheetJob` (all fields, `Status` enum, `CancellationTokenSource`), `OverlaySettings` value object, `MediaInfoDto` (all nullable fields), `PosterSheetRequestDto` (with validation attributes), `PosterSheetStatusDto` in `src/JellyfinRecents.Plugin/Models/`
- [X] T007 Implement `PosterSheetJobService.cs` as `IHostedService` skeleton: `ConcurrentDictionary<string, PosterSheetJob>`, `GetOrAdd` idempotent job creation keyed by `ItemId`, stub `StartAsync`/`StopAsync` in `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs`
- [X] T008 [P] Create `FontAcquisitionService.cs` skeleton: `IHostedService` interface, public `string? FontPath` property, empty `StartAsync` in `src/JellyfinRecents.Plugin/Services/FontAcquisitionService.cs`
- [X] T009 Register `PosterSheetJobService` and `FontAcquisitionService` in the plugin DI container in `src/JellyfinRecents.Plugin/Plugin.cs` (depends on T007, T008)
- [X] T010 [P] Implement `src/poster-gen/src/main.rs` CLI argument parsing with `clap` for all flags from data-model.md: `--ffmpeg-path`, `--input`, `--output`, `--rows`, `--cols`, `--seed`, `--font-path`, `--thumb-width`, and all `--no-*` overlay disable flags
- [X] T011 Add poster-gen binary output config to `src/JellyfinRecents.Plugin/JellyfinRecents.Plugin.csproj`: include `poster-gen-linux-x64` and `poster-gen-win-x64.exe` as content files copied to output directory

**Checkpoint**: Models defined, services registered, CLI skeleton compiles — user story implementation can now begin.

---

## Phase 3: User Story 1 — Generate Thumbnail Sheet (Priority: P1) 🎯 MVP

**Goal**: Complete end-to-end generation flow: user clicks poster button → C# spawns Rust binary → frames extracted → grid image produced → frontend overlay shows progress then result.

**Independent Test**: Unlock via 7-click easter egg → click poster button on any video card → progress counter appears ("N / 48 frames") → JPEG grid appears in overlay with per-frame HH:MM:SS labels → second trigger returns cached image within 1 second.

### Tests for User Story 1

- [X] T012 [P] [US1] Write Rust unit test for even-spacing frame timestamp calculation: given duration=3600s, rows=6, cols=8 → 48 timestamps spaced 75s apart, first at 37.5s in `src/poster-gen/src/main.rs` or `frame_extractor.rs`
- [X] T013 [P] [US1] Write Vitest tests for `registerPosterViewClick()`: 7 clicks within 5 s → returns `true` + sets localStorage; 6 clicks then timeout → counter resets to 0; 7 clicks spread over 6 s → no unlock in `src/frontend/src/state/posterSheetUnlock.test.ts`

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement `frame_extractor.rs`: spawn ffmpeg subprocess with seek-before-input (`ffmpeg -ss {ts} -i {file} -frames:v 1 -vf scale={thumb_width}:-1 -f image2 -vcodec png pipe:1`), capture stdout bytes, return `image::DynamicImage` in `src/poster-gen/src/frame_extractor.rs`
- [X] T015 [P] [US1] Implement `media_info.rs`: spawn `ffprobe -v quiet -print_format json -show_streams -show_format {file}`, deserialize into `MediaInfo` struct (all fields from data-model.md), format for `MEDIA_INFO {json}` stdout line in `src/poster-gen/src/media_info.rs`
- [X] T016 [US1] Implement `image_stitcher.rs`: receive `Vec<(DynamicImage, f64)>` (frame + timestamp_seconds), arrange into rows×cols `RgbImage` grid, draw HH:MM:SS text on each cell using `imageproc::drawing` (ASCII only — cosmic-text wired in Phase 6), JPEG encode to output path in `src/poster-gen/src/image_stitcher.rs` (depends on T014)
- [X] T017 [US1] Implement `main.rs` orchestration: calculate evenly-spaced frame timestamps, extract frames in parallel via `rayon::par_iter`, print `PROGRESS n/total` after each frame, call `media_info`, call `image_stitcher`, print `MEDIA_INFO {json}` then `DONE {path}` on success or `ERROR {msg}` on failure; exit code 0/1 in `src/poster-gen/src/main.rs` (depends on T014, T015, T016)
- [X] T018 [US1] Implement `PosterSheetController.cs`: all 5 REST endpoints — `POST /{itemId}` (202/400/404/422), `GET /{jobId}/status` (200/404), `GET /{jobId}/image` (200/404/409), `DELETE /{jobId}` (204/404), `GET /cache/{itemId}` (200/204) — with route attributes and minimal request/response mapping in `src/JellyfinRecents.Plugin/Api/PosterSheetController.cs` (depends on T007)
- [X] T019 [US1] Implement `PosterSheetJobService.cs` full execution: build CLI args from `PosterSheetJob`, resolve platform binary path + apply `UnixFileMode` chmod on Linux, spawn process with `RedirectStandardOutput = true`, `ReadLineAsync` loop switching on `PROGRESS`/`MEDIA_INFO`/`DONE`/`ERROR` prefixes, update job fields via `Interlocked.Exchange`; implement `File.Exists` cache check before spawning in `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs` (depends on T007, T017)
- [X] T020 [P] [US1] Implement `posterSheetApi.ts`: `startJob(itemId, req)` → POST → `{jobId}`, `pollStatus(jobId)` → GET status → `PosterSheetStatusDto`, `getImageUrl(jobId)` → image endpoint URL string, `cancelJob(jobId)` → DELETE, `checkCache(itemId, params)` → GET cache → `{cached: boolean}` in `src/frontend/src/api/posterSheetApi.ts`
- [X] T021 [P] [US1] Implement `posterSheetUnlock.ts`: module-level click counter + timer, `registerPosterViewClick()` with 7-click / 5000 ms window → sets `localStorage('jr-poster-unlocked', '1')` → returns `true`; `isPosterUnlocked()` reads localStorage in `src/frontend/src/state/posterSheetUnlock.ts`
- [X] T022 [US1] Implement `PosterSheetOverlay.tsx`: manages generation state machine (idle → running → done | error); running state renders "N / M frames captured" with 1 s polling via `pollStatus`; done state renders `<img src={getImageUrl(jobId)}>` full-screen; close handler calls `cancelJob` if not done; error state renders message in `src/frontend/src/components/PosterSheetOverlay.tsx` (depends on T020)
- [X] T023 [US1] Update `App.tsx`: attach `registerPosterViewClick()` to the poster-view (海报视图) toolbar button click handler alongside the existing view-switch logic; add `title="Click me 7 times"` attribute to the button in `src/frontend/src/components/App.tsx` (depends on T021)
- [X] T024 [US1] Update `PlayRecordCard.tsx`: add unified toolbar `<div>` in card top-left containing folder icon + poster sheet button side-by-side; render poster button only when `isPosterUnlocked()` is true and item has a video stream; clicking poster button opens `PosterSheetOverlay` for that item in `src/frontend/src/components/PlayRecordCard.tsx` (depends on T021, T022)

**Checkpoint**: Full end-to-end generation works with default settings (6×8). Progress counter updates; overlay displays completed sheet.

---

## Phase 4: User Story 2 — Configure Grid Size (Priority: P2)

**Goal**: User can adjust rows (1–10) and columns (1–12) before generating; settings survive page reload.

**Independent Test**: Open generation panel, move rows to 4, cols to 6 → frame count preview shows 24 → generate → sheet has 4 rows of 6 thumbnails. Reload page, reopen panel → sliders pre-filled at 4×6.

### Implementation for User Story 2

- [X] T025 [US2] Implement `PosterSheetSettingsPanel.tsx`: rows slider (1–10), cols slider (1–12), live "rows × cols = N frames" label, mode selector stub (deterministic/random), overlay toggle stubs; load initial values from `jr-poster-rows`/`jr-poster-cols` localStorage keys; persist on change in `src/frontend/src/components/PosterSheetSettingsPanel.tsx`
- [X] T026 [US2] Wire `PosterSheetSettingsPanel` into `PosterSheetOverlay.tsx`: render settings panel in idle state; pass `{rows, cols, mode, overlaySettings}` from panel state into `startJob()` call in `src/frontend/src/components/PosterSheetOverlay.tsx` (depends on T025)

**Checkpoint**: Grid size is configurable, survives reload, generated sheets match chosen dimensions.

---

## Phase 5: User Story 3 — Short Video Safeguard (Priority: P2)

**Goal**: Videos under 2 minutes show only valid grid presets; invalid requests rejected server-side with descriptive error.

**Independent Test**: Select a video with `videoDuration < 120`. Open generation panel → free-entry sliders are disabled, only preset buttons satisfying ≥2 s/frame spacing appear. Select a valid preset → generation succeeds. Submit invalid grid via API directly → 400 response with frame count explanation.

### Tests for User Story 3

- [X] T027 [P] [US3] Write Vitest tests for `gridSchema`: `{rows:2, cols:4}` for a 30 s video → valid (3.75 s/frame); `{rows:6, cols:8}` for a 30 s video → invalid (0.625 s/frame); boundary at exactly 2 s/frame → valid in `src/frontend/src/components/PosterSheetSettingsPanel.test.ts`

### Implementation for User Story 3

- [X] T028 [US3] Add Zod `gridSchema` to `PosterSheetSettingsPanel.tsx`: `z.object({rows, cols}).refine(({rows, cols}) => videoDuration / (rows * cols) >= 2, ...)` and apply when `videoDuration < 120` to compute valid preset list in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T025)
- [X] T029 [US3] For short videos (`videoDuration < 120`), replace row/col sliders with preset button grid filtered by `gridSchema`; disable free-entry; show grid density helper text in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T028)
- [X] T030 [US3] Add server-side minimum spacing validation in `PosterSheetController.cs` `POST /{itemId}`: fetch item `RunTimeTicks`, compute `maxFrames = Math.Floor(durationSeconds / 2)`, return `400` with `"Grid too large for video duration. Maximum {maxFrames} frames (2s spacing). Requested: {rows*cols}."` if violated in `src/JellyfinRecents.Plugin/Api/PosterSheetController.cs`

**Checkpoint**: Short video constraint enforced frontend + backend; audio-only items show no poster button.

---

## Phase 6: User Story 6 — Overlay Text and Branding (Priority: P2)

**Goal**: Generated sheets carry configurable branding label (top-right) and video metadata block (top-left); CJK characters render correctly; all overlay settings persist.

**Independent Test**: Default settings → top-right shows "Jellyfin Recents", top-left shows filename + enabled metadata lines. Disable video info → top-left blank. Set branding text to Japanese string (e.g., "最近再生") → characters render without tofu boxes. Disable both overlays → sheet has only thumbnail grid + per-frame timestamps.

### Tests for User Story 6

- [X] T031 [P] [US6] Write Rust unit test for overlay hash (cache key component): serialising same `OverlaySettings` twice → same 8-char SHA-256 prefix; one field toggled → different hash in `src/poster-gen/src/main.rs`

### Implementation for User Story 6

- [X] T032 [US6] Implement `FontAcquisitionService.cs` full logic for both font slots — for each of NotoSansJP and NotoSerifJP: (1) check `{dataDir}/fonts/custom-font-sans.ttf` / `custom-font-serif.ttf` → use if present; (2) check `{dataDir}/fonts/NotoSansJP.ttf` / `NotoSerifJP.ttf` + SHA-256 checksum → use if valid; (3) download from respective Google Fonts URL, verify SHA-256, write checksum; (4) on failure: set corresponding path to null and log actionable error with manual-install instructions; expose `string? NotoSansPath` and `string? NotoSerifPath` properties in `src/JellyfinRecents.Plugin/Services/FontAcquisitionService.cs`
- [X] T033 [P] [US6] Implement `font_manager.rs`: load TTF/OTF from `--font-path` arg into `cosmic_text::FontSystem`; if path is absent or invalid, fall back to built-in minimal bitmap font and log warning in `src/poster-gen/src/font_manager.rs`
- [X] T034 [US6] Implement `text_renderer.rs`: define 5 colour theme structs (classic/dark/light/cinematic/minimal — header background RGBA, text colour, accent colour, timestamp badge background + text colour); use `cosmic_text` to layout branding label (top-right, truncated with ellipsis per FR-020) and video metadata block (top-left, per-line visibility flags); when `--show-timestamp` flag is set, render per-cell HH:MM:SS badge (bottom-left of each cell) using theme badge colours; blit all rendered glyphs onto `RgbImage` buffer in `src/poster-gen/src/text_renderer.rs` (depends on T033)
- [X] T035 [US6] Wire `text_renderer.rs` into `image_stitcher.rs`: call `render_overlay(&mut grid_image, &media_info, &overlay_cfg)` after grid assembly, before JPEG encode in `src/poster-gen/src/image_stitcher.rs` (depends on T034)
- [X] T036 [US6] Wire all overlay CLI flags through the full stack: `--branding-text`, `--no-branding`, `--no-video-info`, per-line `--no-*` flags, `--color-theme {value}`, `--show-timestamp`; map from `main.rs` parsed args into `text_renderer` config; update `PosterSheetJobService.cs` to build all CLI args from `OverlaySettings` including `ColorTheme`, `FontFamily` (resolved to file path via `FontAcquisitionService.NotoSansPath` / `NotoSerifPath`), and `ShowFrameTimestamp` in `src/poster-gen/src/main.rs` + `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs` (depends on T034)
- [X] T037 [US6] Add overlay settings section to `PosterSheetSettingsPanel.tsx`: branding label toggle + text input (max 200 chars), video info master toggle, per-line checkboxes, per-frame timestamp toggle (default OFF); colour theme radio picker (5 options with theme name labels); font family selector (Noto Sans / Noto Serif — each label rendered in its own typeface as live preview); **Preview** button (calls `POST /preview` endpoint via posterSheetApi.ts, see T050, displays returned JPEG inline below settings); load/persist all settings to `jr-poster-overlay` localStorage key as JSON in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T025)

**Checkpoint**: Configurable text overlays baked into generated sheets; CJK renders correctly; changing settings produces a new cache entry.

---

## Phase 7: User Story 4 — Deterministic vs. Random Mode (Priority: P3)

**Goal**: Deterministic mode (default) produces cache-eligible identical sheets for same video+settings; random mode produces fresh sheets with different frame timestamps each time.

**Independent Test**: Generate same video twice in deterministic mode → files are identical (second request is cache hit, served in ≤1 s). Switch to random mode → generate twice → different frame timestamps visible in each sheet; no two adjacent frames are duplicates.

### Implementation for User Story 4

- [X] T038 [P] [US4] Implement deterministic seed in `main.rs`: compute `seed = hex(SHA-256(itemId))[..16]`; derive per-frame timestamps as evenly spaced without jitter; same seed always produces same timestamps in `src/poster-gen/src/main.rs`
- [X] T039 [P] [US4] Implement random mode in `main.rs`: accept GUID seed from `--seed` arg; add per-frame jitter in `(-spacing/4, +spacing/4)` range ensuring adjacent frames remain ≥2 s apart in `src/poster-gen/src/main.rs` (depends on T038)
- [X] T040 [US4] Add mode toggle to `PosterSheetSettingsPanel.tsx` (Deterministic / Random radio); in random mode, generate a UUID seed client-side and pass it in the `startJob()` request body; in deterministic mode omit seed (server computes from itemId); persist `jr-poster-mode` to localStorage in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T025)

**Checkpoint**: Deterministic sheets hit cache on repeat; random mode skips cache and generates fresh each time.

---

## Phase 8: User Story 5 — Large Video Handling (Priority: P3)

**Goal**: 4K video generation completes within 90 s for 6×8 grid; server memory spike does not exceed 500 MB above baseline.

**Independent Test**: Run generation on a 4K test file (e.g., 3840×2160) → completes in ≤90 s; Jellyfin process memory does not increase by more than 500 MB during generation.

### Implementation for User Story 5

- [X] T041 [US5] Cap concurrent ffmpeg processes in `main.rs` via `rayon::ThreadPoolBuilder::new().num_threads(N).build_global()` (e.g., N=4) to prevent simultaneous 4K frame decodes from exhausting memory; tune N based on `--thumb-width` target resolution in `src/poster-gen/src/main.rs`
- [X] T042 [US5] Verify `frame_extractor.rs` uses `-vf scale={thumb_width}:-1` ffmpeg filter for all frame extractions (reduces per-frame peak memory from ~25 MB to ~0.4 MB at width=320); document the tuning rationale in a comment in `src/poster-gen/src/frame_extractor.rs`

**Checkpoint**: 4K generation completes within time budget without server crash.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, edge cases, build pipeline, integration verification.

- [X] T043 [P] Implement error state in `PosterSheetOverlay.tsx`: when `status = "error"` display `job.error` message text and a "Retry" button that re-calls `startJob()` in `src/frontend/src/components/PosterSheetOverlay.tsx`
- [X] T044 [P] Add `422 Unprocessable Entity` response in `PosterSheetController.cs` POST handler when item has no video stream; verify `PlayRecordCard.tsx` hides poster button for audio-only items (where `videoDuration === null`) in `src/JellyfinRecents.Plugin/Api/PosterSheetController.cs` + `src/frontend/src/components/PlayRecordCard.tsx`
- [X] T045 Write C# xUnit tests for `PosterSheetJobService`: job lifecycle (Queued → Running → Done state transitions), cancellation (CancellationToken propagates to process kill), progress update via `Interlocked.Exchange` in `src/JellyfinRecents.Plugin.Tests/PosterSheetJobServiceTests.cs`
- [X] T046 [P] Write C# xUnit API endpoint integration tests: `POST` returns `202` with `jobId`, `GET /status` returns correct JSON shape, `POST` with invalid grid returns `400`, `POST` for audio-only item returns `422` in `src/JellyfinRecents.Plugin.Tests/PosterSheetControllerTests.cs`
- [X] T047 Add cross-compilation build step for Rust: `cargo build --release --target x86_64-unknown-linux-gnu` and `x86_64-pc-windows-msvc`; copy outputs to plugin directory; document build command in `src/JellyfinRecents.Plugin/JellyfinRecents.Plugin.csproj` or a `build.ps1` script
- [X] T048 End-to-end smoke test with performance validation (**手动，需部署后执行**): (1) unlock via 7-click easter egg within 5 s window; (2) generate 6×8 sheet for 1080p test video — **measure wall-clock time, must be ≤30 s (SC-001)**; (3) verify progress counter appears within 3 s of generation start (SC-003); (4) trigger same video+settings again — **must return cached result within 1 s (SC-004)**; (5) verify completed sheet shows branding label and configured overlay; (6) verify closing overlay mid-generation cancels the job; (7) optionally repeat step 2 with a 4K test file — **must complete ≤90 s (SC-002)**
- [X] T049 [P] Implement `poster-gen preview` subcommand: extract logic to `src/poster-gen/src/preview.rs`; generate a 400×270 px JPEG showing a 3×2 grid of solid-colour placeholder cells with full overlay rendered (theme colours, font, branding text, per-line flags, timestamp badge) using sample/hardcoded metadata; accepts same overlay flags as generate subcommand; no ffmpeg call; prints `DONE {path}` or `ERROR {msg}` to stdout in `src/poster-gen/src/preview.rs` + `src/poster-gen/src/main.rs` (depends on T034)
- [X] T050 Add `POST /JellyfinRecents/PosterSheet/preview` endpoint in `PosterSheetController.cs`: receive overlay settings body, build CLI args, spawn `poster-gen preview` synchronously (timeout 5 s), stream resulting JPEG as `image/jpeg` response; return `503` if binary unavailable (fonts not yet ready); update `PosterSheetSettingsPanel.tsx` to call this endpoint on Preview button click and display the returned `<img>` inline in the settings panel in `src/JellyfinRecents.Plugin/Api/PosterSheetController.cs` + `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T049)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Requires Phase 1 — **blocks all user stories**
- **US1 (Phase 3)**: Requires Phase 2 — 🎯 implement first; all other stories build on this
- **US2, US3, US6 (Phases 4–6)**: All require US1 completion; can proceed in parallel with each other (different files)
- **US4 (Phase 7)**: Requires US1 + US2 (mode selector lives in settings panel)
- **US5 (Phase 8)**: Requires US1 (frame_extractor must exist); can proceed in parallel with US2/US3/US6
- **Polish (Phase 9)**: Requires all targeted stories to be complete

### User Story Dependencies

| Story | Requires | Can Overlap With |
|-------|----------|-----------------|
| US1 (P1) | Phase 2 | — |
| US2 (P2) | US1 | US3, US6, US5 |
| US3 (P2) | US1 (videoDuration in card) | US2, US6, US5 |
| US6 (P2) | US1 (image_stitcher exists) | US2, US3, US5 |
| US4 (P3) | US1, US2 (settings panel exists) | US5 |
| US5 (P3) | US1 (frame_extractor exists) | US2, US3, US6, US4 |

### Within Each Story

- Tests first (write tests before implementation; confirm they fail first)
- Rust: parallel Rust modules (frame_extractor + media_info) → image_stitcher → main.rs orchestration
- C#: models (Phase 2) → service → controller
- Frontend: api + state modules (parallel) → overlay component → card integration

### Parallel Opportunities

- **Phase 1**: T002 and T003 run in parallel
- **Phase 2**: T004/T005 parallel; T007/T008/T010 can all start together
- **Phase 3**: T014 and T015 (different Rust files); T020 and T021 (different frontend files); T012 and T013 (tests, different files)
- **After Phase 3**: Phases 4, 5, 6, and 8 can all start simultaneously

---

## Parallel Example: User Story 1

```bash
# Rust extraction layer — launch in parallel:
T014: Implement frame_extractor.rs
T015: Implement media_info.rs

# Frontend state layer — launch in parallel:
T020: Implement posterSheetApi.ts
T021: Implement posterSheetUnlock.ts

# After T014 + T015 complete:
T016: Implement image_stitcher.rs

# After T016 complete:
T017: Update main.rs orchestration (depends on T014, T015, T016)

# After T021 complete:
T022: Implement PosterSheetOverlay.tsx (depends on T020)

# After T021 + T022 complete:
T023: Update App.tsx (easter egg wiring)
T024: Update PlayRecordCard.tsx (toolbar + overlay launch)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Trigger generation end-to-end; verify progress + sheet in overlay
5. Build and test Rust binary standalone (`cargo test` + manual CLI invocation) **before** wiring C# around it

### Incremental Delivery

1. Phase 1 + Phase 2 → Project scaffold ready
2. Phase 3 (US1) → Core generation working (**MVP!**)
3. Phases 4+5+6 in parallel → Grid config + safety guardrails + overlay text
4. Phases 7+8 → Power-user mode + 4K performance
5. Phase 9 → Polish, tests, build pipeline

### Recommended Development Sequence

Start with the Rust binary in complete isolation. Build it, run `cargo test`, invoke it manually against a real video file (`./poster-gen-linux-x64 --ffmpeg-path /usr/lib/jellyfin-ffmpeg/ffmpeg --input test.mkv --output out.jpg --rows 6 --cols 8 --seed abc123 --font-path fonts/NotoSansJP.ttf --thumb-width 320`). Only after the binary produces a correct JPEG should you wire the C# job service around it. Then integrate the frontend last.

---

## Phase 10: Auth Fix, SSE, Task Queue, i18n, Mobile, CI (FR-025–030)

**Purpose**: Address discovered gaps — authentication, real-time progress via SSE, multi-task queue widget, file auto-cleanup, i18n and mobile responsive for settings panel, and CI pipeline correctness.

**⚠️ NOTE**: T055 (401 fix) MUST be completed first — all other tasks in this phase that make API calls depend on it.

### Critical Fix

- [X] T055 Fix authentication in `posterSheetApi.ts`: replace all bare `fetch()` calls with a thin helper `function apiFetch(url, init?)` that automatically injects `Authorization: MediaBrowser Token="${window.ApiClient!.accessToken()}"` and `Content-Type: application/json`; update `startJob`, `pollStatus`, `cancelJob`, `checkCache`, `fetchPreview` to use the helper in `src/frontend/src/api/posterSheetApi.ts`

### SSE Progress (FR-026)

- [X] T056 Add SSE endpoint in `PosterSheetController.cs`: `GET /JellyfinRecents/PosterSheet/{jobId}/stream` — set `Content-Type: text/event-stream`, emit `data: {json}\n\n` every 500 ms with full job status DTO; close when done/error/cancelled; uses `?api_key=` query param for EventSource auth (Jellyfin's standard alternative auth) in `src/JellyfinRecents.Plugin/Controllers/PosterSheetController.cs`
- [X] T057 Replace polling in `PosterSheetOverlay.tsx` with SSE `EventSource`: construct URL as `/JellyfinRecents/PosterSheet/{jobId}/stream?api_key=${token}`; handle `message` events to update progress/done/error state; close `EventSource` in cleanup; fall back to 1 s `pollStatus` polling if `EventSource` throws `onerror` in `src/frontend/src/components/PosterSheetOverlay.tsx` (depends on T056)

### Task Queue Widget (FR-027)

- [X] T058 Create `src/frontend/src/state/posterJobStore.ts`: module-level `Map<string, JobEntry>` (jobId → `{jobId, itemTitle, status, progress, total, imageUrl?}`); export `addJob(jobId, itemTitle)`, `updateJob(jobId, patch)`, `removeJob(jobId)`, `getJobs()`; dispatch a `CustomEvent('jr-poster-jobs-changed')` on `window` after each mutation so subscribers can re-render
- [X] T059 [P] Create `src/frontend/src/components/PosterQueueWidget.tsx`: fixed bottom-right (position: fixed; right: 1.5rem; bottom: 1.5rem); renders a 44×44 px icon button (MdGridView or a cart-style icon); badge in top-right corner showing count of running+queued jobs (hidden when 0); clicking toggles a popover that lists all jobs from `posterJobStore`; each entry shows item title, status, progress bar while running, `<img>` thumbnail when done (uses `getImageUrl(jobId)` with auth header workaround — set `<img src={getImageUrl}>` since image endpoint uses cookie auth or add token param), and a delete button that calls `cancelJob` + `removeJob`; mount in `App.tsx` when `posterUnlocked` is true; CSS in `src/frontend/src/styles.css` in `src/frontend/src/components/PosterQueueWidget.tsx`
- [X] T060 [P] Wire `PosterQueueWidget` into `App.tsx`: import and render `<PosterQueueWidget />` after the toolbar, guarded by `{posterUnlocked && <PosterQueueWidget />}`; update `PosterSheetOverlay.tsx` to call `addJob` / `updateJob` / `removeJob` from the store as job state changes in `src/frontend/src/components/App.tsx` + `src/frontend/src/components/PosterSheetOverlay.tsx` (depends on T058, T059)

### Auto-cleanup (FR-028)

- [X] T061 Change output directory in `PosterSheetJobService.cs` from plugin data directory to `Path.GetTempPath()`; add `CleanTempFiles()` method that deletes `postersheet-*.jpg` files older than 24 hours from temp dir; call `CleanTempFiles()` in `StartAsync` (plugin load) and on a 1-hour background timer; update `GetBinaryPath()` cache-hit check to verify `File.Exists` before returning cached path in `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs`

### i18n for Settings Panel (FR-029)

- [X] T062 Add i18n keys for `PosterSheetSettingsPanel` to all locale files in `src/frontend/src/i18n/`: keys for title ("Poster Sheet Settings"), section labels ("Grid", "Mode", "Overlay", "Theme", "Font"), button labels ("Preview", "Generate", "Deterministic", "Random"), sub-labels ("Branding label", "Video info block", "File size", "Resolution & FPS", "Video encoding", "Audio encoding", "Duration", "Per-frame timestamp badge"), and status text ("Generating preview...", "frames", "too many for", "s video"); update `src/frontend/src/i18n/index.ts` type definition in `src/frontend/src/i18n/`
- [X] T063 [P] Update `PosterSheetSettingsPanel.tsx` to consume i18n: replace all hardcoded English strings with `t.posterXxx` keys from `useLocale()`; move the **Preview** button outside the `!settingsOnly` block so it is visible in all contexts; only the **Generate** button remains inside `!settingsOnly` in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T062)

### Mobile Responsive (FR-030)

- [X] T064 [P] Add mobile CSS for `PosterSheetSettingsPanel` in `src/frontend/src/styles.css`: at `max-width: 640px`, stack `.jr-poster-settings__section` into single column, set `.jr-poster-settings__slider-row` to `flex-direction: column`, ensure all interactive controls have `min-height: 44px` and `min-width: 44px`; add mobile styles for `.jr-poster-toolbar-panel` to scroll horizontally on narrow viewports in `src/frontend/src/styles.css`

### Preview Bug Fix (FR-031)

- [X] T066 Fix preview endpoint: (1) add `[AllowAnonymous]` to `POST /preview` action (no user data involved; stateless sample image); (2) add stderr capture to the preview process and log it for diagnosis; (3) investigate and fix the root cause of the 400 error — likely font path quoting or argument escaping in `BuildPreviewArgs`; (4) add a Vitest or manual test confirming `POST /preview` returns a valid JPEG in `src/JellyfinRecents.Plugin/Controllers/PosterSheetController.cs`

### CI Pipeline Fix

- [X] T065 Update `.github/workflows/release.yml`: (1) add `Rust build` step using `cargo build --release -j 2` with `rust-cache` action; (2) copy `target/release/poster-gen` binary into publish dir as `poster-gen-linux-x64` and `chmod +x`; (3) include `poster-gen-linux-x64` in the release zip alongside `JellyfinRecents.Plugin.dll meta.json`; (4) add test steps before build: `cargo test` (Rust), `npm run build` already validates TypeScript, `dotnet test` (C# xUnit, skip if no test project yet) in `.github/workflows/release.yml`

---

## Phase 11: Queue Widget Bug Fixes (FR-032–FR-035)

**Purpose**: Fix discovered defects in the poster queue widget, wire TTF font rendering, add Jellyfin logo watermark, and implement configurable timestamp positioning.

**⚠️ CRITICAL**: T067 must complete before T068; T068 must complete before T069 (z-index layering affects Lightbox visibility in all contexts). T074 (font) and T075 (logo) are independent of the queue fixes and can run in parallel with T067–T073.

### Bug 1 — Multi-job image misattribution (FR-032)

- [X] T067 Fix `PosterSheetJobService.cs` job storage: change `_jobs` from `ConcurrentDictionary<string, PosterSheetJob>` keyed by **itemId** to keyed by **jobId**; add a separate `ConcurrentDictionary<string, string> _activeJobIdByItemId` (itemId → latest jobId for cache-dedup check only); update `GetOrCreateJob` to store `_jobs[job.Id] = job` and `_activeJobIdByItemId[itemId] = job.Id`; update `GetJob(jobId)` from `_jobs.Values.FirstOrDefault(j => j.Id == jobId)` to `_jobs.TryGetValue(jobId, out var job) ? job : null`; update `CancelJob`, `Dispose`, and `CleanTempFiles` to iterate `_jobs.Values`; fix `CheckCache` endpoint to query `_activeJobIdByItemId` for the dedup check in `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs` + `src/JellyfinRecents.Plugin/Controllers/PosterSheetController.cs`

### Bug 2 — Queue popover non-interactive (FR-033)

- [X] T068 [P] Fix CSS z-index layering in `src/frontend/src/styles.css`: raise `.jr-queue-popover` from `z-index: 901` to `z-index: 999999` (above the `jr-popover-overlay` backdrop at 999998); raise `.jr-lightbox` from `z-index: 9999` to `z-index: 1000000` (above both the popover backdrop and the popover content) in `src/frontend/src/styles.css`

### Bug 3 — Settings panel preview not openable in Lightbox (FR-035)

- [X] T069 [P] Wire Lightbox into `PosterSheetSettingsPanel.tsx`: import `Lightbox` from `./Lightbox`; add `previewLightboxOpen` boolean state (default `false`); add `onClick={() => setPreviewLightboxOpen(true)}` and `style="cursor:pointer"` to the existing `<img class="jr-poster-settings__preview-img" />`; render `{previewLightboxOpen && <Lightbox src={previewUrl!} alt={t.posterPreview} onClose={() => setPreviewLightboxOpen(false)} onDownload={() => downloadBlob(previewUrl!, 'poster-preview.jpg')} />}` after the image in `src/frontend/src/components/PosterSheetSettingsPanel.tsx`

*(Bug 4 — queue thumbnail Lightbox not visible — is resolved by T068's z-index fix; no additional code change needed in `PosterQueueWidget.tsx`.)*

### Lightbox Enhancement — Delete and Download Buttons (FR-034, FR-035)

- [X] T070 Enhance `Lightbox.tsx` component: add optional props `onDownload?: () => void` and `onDelete?: () => void`; when `onDownload` is provided, render a **Download** button in the Lightbox footer that triggers it; when `onDelete` is provided, render a **Delete** button in the Lightbox footer that calls it then closes; add `downloadBlob(url, filename)` utility in `src/frontend/src/utils/download.ts` that creates a temporary `<a download>` element and clicks it; wire download into `PosterQueueWidget.tsx` thumbnail Lightbox (downloads via `getImageUrl(jobId)`), and wire delete into `PosterQueueWidget.tsx` (calls `handleDelete(job)` from existing handler then closes Lightbox); add CSS for Lightbox footer button row in `src/frontend/src/styles.css` in `src/frontend/src/components/Lightbox.tsx` + `src/frontend/src/utils/download.ts` + `src/frontend/src/components/PosterQueueWidget.tsx` + `src/frontend/src/styles.css`

### Configurable Timestamp Position (FR-036)

- [X] T071 Add `TimestampPosition` enum and field to C# `OverlaySettings` model: `enum TimestampPosition { InsideBottomLeft, OutsideBottomLeft, InsideBottomCenter, OutsideBottomCenter, InsideBottomRight, OutsideBottomRight }`; add `TimestampPosition TimestampPosition { get; set; } = TimestampPosition.InsideBottomLeft` to `OverlaySettings`; map to `--timestamp-position {value}` CLI arg in `PosterSheetJobService.cs`; add `timestampPosition` to `OverlaySettingsDto` C# class and include in the overlay hash computation in `src/JellyfinRecents.Plugin/Models/`  + `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs`
- [X] T072 Add `--timestamp-position` CLI flag to Rust `main.rs` (6 values, default `inside-bottom-left`); update `OverlayConfig` struct in `text_renderer.rs` to add `timestamp_position: TimestampPosition` enum; implement positioning logic in `text_renderer.rs`: for `inside-*` variants, render badge within the cell at the appropriate X offset (left/center/right); for `outside-*` variants, render badge in the reserved gap row below the cell; update `image_stitcher.rs` to add `inter_row_gap` (default 0 for inside variants, 24 px for outside variants) to the vertical layout calculation so outside labels have room; update `preview.rs` to pass position through in `src/poster-gen/src/main.rs` + `src/poster-gen/src/text_renderer.rs` + `src/poster-gen/src/image_stitcher.rs` + `src/poster-gen/src/preview.rs`
- [X] T073 [P] Add `timestampPosition` to `OverlaySettingsDto` TypeScript type in `src/frontend/src/api/posterSheetApi.ts`; add timestamp position selector UI to `PosterSheetSettingsPanel.tsx` (visible only when timestamp badge is enabled): a radio-group with 6 options; add i18n keys for all 6 labels (`posterTimestampPos*`) to all locale files; persist `timestampPosition` inside the `jr-poster-overlay` localStorage JSON; default to `'inside-bottom-left'` in `src/frontend/src/api/posterSheetApi.ts` + `src/frontend/src/components/PosterSheetSettingsPanel.tsx` + `src/frontend/src/i18n/`

### Thumbnail Grid Spacing (FR-039)

- [X] T076 [P] Add inter-cell gap and canvas border padding to Rust image stitcher and preview: (1) define constants `CELL_GAP: u32 = 4` and `GRID_PADDING: u32 = 8` in `src/poster-gen/src/image_stitcher.rs`; (2) recalculate total canvas width/height as `GRID_PADDING * 2 + cols * cell_w + (cols - 1) * CELL_GAP` (width) and `HEADER_H + GRID_PADDING * 2 + rows * cell_h + (rows - 1) * CELL_GAP` (height), keeping `cell_w`/`cell_h` identical to before so individual thumbnail resolution is unchanged; (3) place each cell at `x = GRID_PADDING + col * (cell_w + CELL_GAP)`, `y = HEADER_H + GRID_PADDING + row * (cell_h + CELL_GAP)`; (4) apply the same constants in `src/poster-gen/src/preview.rs`; (5) update any Rust unit tests that assert exact canvas dimensions in `src/poster-gen/src/image_stitcher.rs` + `src/poster-gen/src/preview.rs`

### TTF Font Rendering Fix (FR-037)

- [X] T074 Fix Rust TTF font rendering: (1) remove `cosmic-text = "0.19"` from `src/poster-gen/Cargo.toml` and add `ab_glyph = "0.2"`; (2) in `src/poster-gen/src/text_renderer.rs`, implement `load_font(path: &str) -> Option<ab_glyph::FontArc>` that reads the TTF file and returns `None` on failure with a logged warning; (3) replace all `draw_text_scaled()` pixel-bitmap calls with a new `draw_text_ttf(img, font, text, x, y, scale, color)` function using `ab_glyph`'s glyph layout and `imageproc::drawing::draw_filled_rect_mut` for pixel blitting; (4) keep the existing pixel bitmap as fallback when `font` is `None`; (5) verify CJK characters (e.g., "文件名" "再生時間") render without tofu boxes when `NotoSansJP.ttf` is supplied via `--font-path`; (6) update `src/poster-gen/src/preview.rs` to pass font through to overlay rendering in `src/poster-gen/Cargo.toml` + `src/poster-gen/src/text_renderer.rs` + `src/poster-gen/src/preview.rs`

### Jellyfin Logo Watermark (FR-038)

- [X] T075 Add Jellyfin logo watermark to poster sheet header: (1) add `resvg = "0.44"` and `tiny-skia = "0.11"` to `src/poster-gen/Cargo.toml`; (2) embed the Jellyfin icon SVG bytes as a `const` in a new `src/poster-gen/src/logo.rs` file — download the SVG from `https://upload.wikimedia.org/wikipedia/commons/8/8e/Jellyfin_-_icon-transparent.svg` and store as a Rust byte-string literal; (3) implement `render_logo(canvas: &mut RgbImage, canvas_w: u32, canvas_h: u32)`: rasterise the SVG at width = `canvas_w * 2 / 3` using `resvg` + `tiny-skia`, alpha-composite onto the canvas anchored to the top-right corner at ~20 % opacity (blend each RGBA pixel: `out = logo_alpha * logo_rgb + (1 - logo_alpha * 0.20) * bg_rgb`), and allow the logo to extend downward into the thumbnail rows (no clipping); (4) call `render_logo` in `image_stitcher.rs` after the header background is filled but before thumbnails are placed; (5) call it in `preview.rs` as well; (6) remove the existing `draw_disc_decoration()` function and all call-sites in `src/poster-gen/Cargo.toml` + `src/poster-gen/src/logo.rs` + `src/poster-gen/src/image_stitcher.rs` + `src/poster-gen/src/preview.rs` + `src/poster-gen/src/text_renderer.rs`

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks within the same phase
- `[US#]` label maps task to spec.md user story number for traceability
- Rust binary must be cross-compiled separately; `cargo build --release` is not part of `dotnet build`
- `FontAcquisitionService.StartAsync` must be non-blocking — run font download as a background `Task` and not `await` it synchronously
- In deterministic mode, the cache key (`{itemId}_{rows}x{cols}_{seed}_{overlayHash}.jpg`) is stable across restarts; a cache hit avoids any Rust invocation
- The 7-click easter egg is wired to the **poster-view toolbar button** (海报视图, the view-switcher in App.tsx), not to the per-card poster sheet button
- `OverlayHash` = first 8 chars of SHA-256(JSON of `OverlaySettings`); must be computed identically in both C# (cache filename) and Rust (for verification)
- `TimestampPosition` is part of the overlay hash — any outside variant changes the inter-row gap in the generated image, making it a distinct cache entry
- The Lightbox `onDownload` prop uses a `<a download>` click trick; no server-side change is needed (the image URL is already directly accessible)

---

## Phase 12: Branding Font Separation, UI Polish, Timestamp Precision (FR-040–FR-047)

**Purpose**: Separate branding font, graphical timestamp picker, improved timestamp precision, UI consistency, and various layout fixes.

- [X] T077 Separate branding font from info font: add `BrandingFontFamily` to C# `OverlaySettings`, `--branding-font-path` to Rust CLI + `OverlayConfig` + `PreviewArgs`, `brandingFontFamily` to TypeScript `OverlaySettingsDto`; `render_overlay` loads and uses separate branding font (falls back to `font_path`)
- [X] T078 Add branding font selector UI in `PosterSheetSettingsPanel.tsx`: shown only when branding is enabled; uses `brandingFontFamily` field; character-type detection (`hasCJK` / `hasLatin`) for future Latin font expansion
- [X] T079 Replace all radio `<input>` components with toggle buttons (matching theme/font button style) for mode and language selectors
- [X] T080 Replace timestamp position radio list with graphical picker: outer container box → inner dashed thumbnail box → 6 small `"00:00"` buttons at inside/outside bottom-left/center/right positions
- [X] T081 Increase timestamp precision from `HH:MM:SS` to `HH:MM:SS.mmm` (milliseconds); update `secs_to_hhmmss` function and unit tests
- [X] T082 Fix timestamp badge sizing: use TTF-aware character width estimate (`b_ttf * 7/12`), center text horizontally and vertically within badge for TTF mode
- [X] T083 Remove filename truncation: render full filename without ellipsis or character limits
- [X] T084 Add i18n-aware `lbl_video` prefix ("视频：" / "Video: " / "映像：") to resolution row
- [X] T085 Fix classic theme header background: change from `[0,0,0,180]` to `[45,45,50,200]` so classic is lighter than dark `[18,18,18,200]`
- [X] T086 Add `transparent` theme: `header_bg = [0,0,0,0]`, skip black background fill, skip logo render, encode as WebP lossless with alpha
- [X] T087 Redesign Lightbox: add zoom buttons (`MdZoomIn`/`MdZoomOut`/`MdFitScreen`), cursor-following wheel zoom via scroll position pinning, mouse-drag panning, all text buttons replaced with react-icons
- [X] T088 Change preview flow: generate preview → open Lightbox directly (no inline `<img>` in settings panel)
- [X] T089 Migrate output format from JPEG to WebP: `image_stitcher.rs` + `preview.rs` use `WebPEncoder::new_lossless` with `RgbaImage`, C# output paths use `.webp` extension, API returns `image/webp` MIME type
- [X] T090 Fix Jellyfin SVG logo to official icon from Wikimedia Commons; move logo rendering to before thumbnails (layer order: background → logo → thumbnails → text → badges)
- [X] T091 Increase info text scale from 2 to 4 (24px TTF), branding scale from 3 to 10 (60px TTF), `HEADER_H` from 72 to 144, tighten line spacing from 40px to 28px; position branding at top-right corner
- [X] T092 Add i18n keys for `posterBrandingFont` and `posterTimestampPos*` to all three locale files (en/zh/ja)

---

## Phase 13: Remaining Issues (FR-048–FR-053)

**Purpose**: Fix outstanding bugs and polish remaining rough edges.

### Bug 1 — Drag panning in Lightbox (FR-048)

- [X] T093 Fix mouse drag panning in `Lightbox.tsx`: rewrote zoom/pan system to use CSS `transform: translate+scale` on a canvas div; drag panning via window mousemove listeners updates pan refs and applies transform directly — no scrollLeft/scrollTop needed.

### Bug 2 — Cursor-following zoom in Lightbox (FR-049)

- [X] T094 Fix cursor-following wheel zoom in `Lightbox.tsx`: replaced double-RAF+scrollLeft approach with CSS transform; cursor-point is kept fixed mathematically (`newPan = cursor - (cursor - oldPan) * ratio`) with no layout reflow needed.

### Font options for western text (FR-050)

- [X] T095 Fix font option names: "Noto Sans JP" → "Noto Sans", "Noto Serif JP" → "Noto Serif" in `PosterSheetSettingsPanel.tsx` FONTS array.
- [X] T096 Remove unused `hasCJK`/`hasLatin` helpers and dead filter — all fonts support Latin; `brandFontOptions = FONTS` directly.
- [ ] T097 Download additional Latin font files via `FontAcquisitionService.cs`: add Noto Sans (Latin subset) and Noto Serif (Latin subset) font acquisition with SHA-256 verification, following the same pattern as existing CJK fonts.

### UI polish (FR-051–FR-053)

- [X] T098 Swap grid rows/cols order in `PosterSheetSettingsPanel.tsx`: columns slider now appears first, rows second.
- [X] T099 Add descriptive tooltip `title` to Mode toggle buttons: Deterministic tip and Random tip added to all three locale files + `Translations` type.
- [X] T100 Remove bottom border from preview section: added `.jr-poster-settings__section:last-of-type { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }` in `styles.css`.
