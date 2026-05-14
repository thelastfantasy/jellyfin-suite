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

- [ ] T001 Initialize Rust crate at `src/poster-gen/Cargo.toml` with all dependencies: `image`, `cosmic-text = "0.19"`, `rayon`, `serde_json`, `sha2`, `clap` (with derive feature)
- [ ] T002 [P] Create C# model file stubs (namespace + empty class only) in `src/JellyfinRecents.Plugin/Models/`: `PosterSheetJob.cs`, `PosterSheetRequestDto.cs`, `PosterSheetStatusDto.cs`, `MediaInfoDto.cs`
- [ ] T003 [P] Create empty Rust source files for the new modules: `src/poster-gen/src/frame_extractor.rs`, `media_info.rs`, `image_stitcher.rs`, `text_renderer.rs`, `font_manager.rs`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure and data-contract changes that MUST be complete before any user story work begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Extend `PlayRecord` response: add `videoDuration` field (`RunTimeTicks / 10_000_000`, `null` for audio-only) to `GET /JellyfinRecents/PlayHistory` in `src/JellyfinRecents.Plugin/Api/HistoryController.cs`
- [ ] T005 [P] Add `videoDuration: number | null` field to `PlayRecord` TypeScript type in `src/frontend/src/types.ts`
- [ ] T006 Fill in all C# model definitions per data-model.md: `PosterSheetJob` (all fields, `Status` enum, `CancellationTokenSource`), `OverlaySettings` value object, `MediaInfoDto` (all nullable fields), `PosterSheetRequestDto` (with validation attributes), `PosterSheetStatusDto` in `src/JellyfinRecents.Plugin/Models/`
- [ ] T007 Implement `PosterSheetJobService.cs` as `IHostedService` skeleton: `ConcurrentDictionary<string, PosterSheetJob>`, `GetOrAdd` idempotent job creation keyed by `ItemId`, stub `StartAsync`/`StopAsync` in `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs`
- [ ] T008 [P] Create `FontAcquisitionService.cs` skeleton: `IHostedService` interface, public `string? FontPath` property, empty `StartAsync` in `src/JellyfinRecents.Plugin/Services/FontAcquisitionService.cs`
- [ ] T009 Register `PosterSheetJobService` and `FontAcquisitionService` in the plugin DI container in `src/JellyfinRecents.Plugin/Plugin.cs` (depends on T007, T008)
- [ ] T010 [P] Implement `src/poster-gen/src/main.rs` CLI argument parsing with `clap` for all flags from data-model.md: `--ffmpeg-path`, `--input`, `--output`, `--rows`, `--cols`, `--seed`, `--font-path`, `--thumb-width`, and all `--no-*` overlay disable flags
- [ ] T011 Add poster-gen binary output config to `src/JellyfinRecents.Plugin/JellyfinRecents.Plugin.csproj`: include `poster-gen-linux-x64` and `poster-gen-win-x64.exe` as content files copied to output directory

**Checkpoint**: Models defined, services registered, CLI skeleton compiles — user story implementation can now begin.

---

## Phase 3: User Story 1 — Generate Thumbnail Sheet (Priority: P1) 🎯 MVP

**Goal**: Complete end-to-end generation flow: user clicks poster button → C# spawns Rust binary → frames extracted → grid image produced → frontend overlay shows progress then result.

**Independent Test**: Unlock via 7-click easter egg → click poster button on any video card → progress counter appears ("N / 48 frames") → JPEG grid appears in overlay with per-frame HH:MM:SS labels → second trigger returns cached image within 1 second.

### Tests for User Story 1

- [ ] T012 [P] [US1] Write Rust unit test for even-spacing frame timestamp calculation: given duration=3600s, rows=6, cols=8 → 48 timestamps spaced 75s apart, first at 37.5s in `src/poster-gen/src/main.rs` or `frame_extractor.rs`
- [ ] T013 [P] [US1] Write Vitest tests for `registerPosterViewClick()`: 7 clicks within 5 s → returns `true` + sets localStorage; 6 clicks then timeout → counter resets to 0; 7 clicks spread over 6 s → no unlock in `src/frontend/src/state/posterSheetUnlock.test.ts`

### Implementation for User Story 1

- [ ] T014 [P] [US1] Implement `frame_extractor.rs`: spawn ffmpeg subprocess with seek-before-input (`ffmpeg -ss {ts} -i {file} -frames:v 1 -vf scale={thumb_width}:-1 -f image2 -vcodec png pipe:1`), capture stdout bytes, return `image::DynamicImage` in `src/poster-gen/src/frame_extractor.rs`
- [ ] T015 [P] [US1] Implement `media_info.rs`: spawn `ffprobe -v quiet -print_format json -show_streams -show_format {file}`, deserialize into `MediaInfo` struct (all fields from data-model.md), format for `MEDIA_INFO {json}` stdout line in `src/poster-gen/src/media_info.rs`
- [ ] T016 [US1] Implement `image_stitcher.rs`: receive `Vec<(DynamicImage, f64)>` (frame + timestamp_seconds), arrange into rows×cols `RgbImage` grid, draw HH:MM:SS text on each cell using `imageproc::drawing` (ASCII only — cosmic-text wired in Phase 6), JPEG encode to output path in `src/poster-gen/src/image_stitcher.rs` (depends on T014)
- [ ] T017 [US1] Implement `main.rs` orchestration: calculate evenly-spaced frame timestamps, extract frames in parallel via `rayon::par_iter`, print `PROGRESS n/total` after each frame, call `media_info`, call `image_stitcher`, print `MEDIA_INFO {json}` then `DONE {path}` on success or `ERROR {msg}` on failure; exit code 0/1 in `src/poster-gen/src/main.rs` (depends on T014, T015, T016)
- [ ] T018 [US1] Implement `PosterSheetController.cs`: all 5 REST endpoints — `POST /{itemId}` (202/400/404/422), `GET /{jobId}/status` (200/404), `GET /{jobId}/image` (200/404/409), `DELETE /{jobId}` (204/404), `GET /cache/{itemId}` (200/204) — with route attributes and minimal request/response mapping in `src/JellyfinRecents.Plugin/Api/PosterSheetController.cs` (depends on T007)
- [ ] T019 [US1] Implement `PosterSheetJobService.cs` full execution: build CLI args from `PosterSheetJob`, resolve platform binary path + apply `UnixFileMode` chmod on Linux, spawn process with `RedirectStandardOutput = true`, `ReadLineAsync` loop switching on `PROGRESS`/`MEDIA_INFO`/`DONE`/`ERROR` prefixes, update job fields via `Interlocked.Exchange`; implement `File.Exists` cache check before spawning in `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs` (depends on T007, T017)
- [ ] T020 [P] [US1] Implement `posterSheetApi.ts`: `startJob(itemId, req)` → POST → `{jobId}`, `pollStatus(jobId)` → GET status → `PosterSheetStatusDto`, `getImageUrl(jobId)` → image endpoint URL string, `cancelJob(jobId)` → DELETE, `checkCache(itemId, params)` → GET cache → `{cached: boolean}` in `src/frontend/src/api/posterSheetApi.ts`
- [ ] T021 [P] [US1] Implement `posterSheetUnlock.ts`: module-level click counter + timer, `registerPosterViewClick()` with 7-click / 5000 ms window → sets `localStorage('jr-poster-unlocked', '1')` → returns `true`; `isPosterUnlocked()` reads localStorage in `src/frontend/src/state/posterSheetUnlock.ts`
- [ ] T022 [US1] Implement `PosterSheetOverlay.tsx`: manages generation state machine (idle → running → done | error); running state renders "N / M frames captured" with 1 s polling via `pollStatus`; done state renders `<img src={getImageUrl(jobId)}>` full-screen; close handler calls `cancelJob` if not done; error state renders message in `src/frontend/src/components/PosterSheetOverlay.tsx` (depends on T020)
- [ ] T023 [US1] Update `App.tsx`: attach `registerPosterViewClick()` to the poster-view (海报视图) toolbar button click handler alongside the existing view-switch logic; add `title="Click me 7 times"` attribute to the button in `src/frontend/src/components/App.tsx` (depends on T021)
- [ ] T024 [US1] Update `PlayRecordCard.tsx`: add unified toolbar `<div>` in card top-left containing folder icon + poster sheet button side-by-side; render poster button only when `isPosterUnlocked()` is true and item has a video stream; clicking poster button opens `PosterSheetOverlay` for that item in `src/frontend/src/components/PlayRecordCard.tsx` (depends on T021, T022)

**Checkpoint**: Full end-to-end generation works with default settings (6×8). Progress counter updates; overlay displays completed sheet.

---

## Phase 4: User Story 2 — Configure Grid Size (Priority: P2)

**Goal**: User can adjust rows (1–10) and columns (1–12) before generating; settings survive page reload.

**Independent Test**: Open generation panel, move rows to 4, cols to 6 → frame count preview shows 24 → generate → sheet has 4 rows of 6 thumbnails. Reload page, reopen panel → sliders pre-filled at 4×6.

### Implementation for User Story 2

- [ ] T025 [US2] Implement `PosterSheetSettingsPanel.tsx`: rows slider (1–10), cols slider (1–12), live "rows × cols = N frames" label, mode selector stub (deterministic/random), overlay toggle stubs; load initial values from `jr-poster-rows`/`jr-poster-cols` localStorage keys; persist on change in `src/frontend/src/components/PosterSheetSettingsPanel.tsx`
- [ ] T026 [US2] Wire `PosterSheetSettingsPanel` into `PosterSheetOverlay.tsx`: render settings panel in idle state; pass `{rows, cols, mode, overlaySettings}` from panel state into `startJob()` call in `src/frontend/src/components/PosterSheetOverlay.tsx` (depends on T025)

**Checkpoint**: Grid size is configurable, survives reload, generated sheets match chosen dimensions.

---

## Phase 5: User Story 3 — Short Video Safeguard (Priority: P2)

**Goal**: Videos under 2 minutes show only valid grid presets; invalid requests rejected server-side with descriptive error.

**Independent Test**: Select a video with `videoDuration < 120`. Open generation panel → free-entry sliders are disabled, only preset buttons satisfying ≥2 s/frame spacing appear. Select a valid preset → generation succeeds. Submit invalid grid via API directly → 400 response with frame count explanation.

### Tests for User Story 3

- [ ] T027 [P] [US3] Write Vitest tests for `gridSchema`: `{rows:2, cols:4}` for a 30 s video → valid (3.75 s/frame); `{rows:6, cols:8}` for a 30 s video → invalid (0.625 s/frame); boundary at exactly 2 s/frame → valid in `src/frontend/src/components/PosterSheetSettingsPanel.test.ts`

### Implementation for User Story 3

- [ ] T028 [US3] Add Zod `gridSchema` to `PosterSheetSettingsPanel.tsx`: `z.object({rows, cols}).refine(({rows, cols}) => videoDuration / (rows * cols) >= 2, ...)` and apply when `videoDuration < 120` to compute valid preset list in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T025)
- [ ] T029 [US3] For short videos (`videoDuration < 120`), replace row/col sliders with preset button grid filtered by `gridSchema`; disable free-entry; show grid density helper text in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T028)
- [ ] T030 [US3] Add server-side minimum spacing validation in `PosterSheetController.cs` `POST /{itemId}`: fetch item `RunTimeTicks`, compute `maxFrames = Math.Floor(durationSeconds / 2)`, return `400` with `"Grid too large for video duration. Maximum {maxFrames} frames (2s spacing). Requested: {rows*cols}."` if violated in `src/JellyfinRecents.Plugin/Api/PosterSheetController.cs`

**Checkpoint**: Short video constraint enforced frontend + backend; audio-only items show no poster button.

---

## Phase 6: User Story 6 — Overlay Text and Branding (Priority: P2)

**Goal**: Generated sheets carry configurable branding label (top-right) and video metadata block (top-left); CJK characters render correctly; all overlay settings persist.

**Independent Test**: Default settings → top-right shows "Jellyfin Recents", top-left shows filename + enabled metadata lines. Disable video info → top-left blank. Set branding text to Japanese string (e.g., "最近再生") → characters render without tofu boxes. Disable both overlays → sheet has only thumbnail grid + per-frame timestamps.

### Tests for User Story 6

- [ ] T031 [P] [US6] Write Rust unit test for overlay hash (cache key component): serialising same `OverlaySettings` twice → same 8-char SHA-256 prefix; one field toggled → different hash in `src/poster-gen/src/main.rs`

### Implementation for User Story 6

- [ ] T032 [US6] Implement `FontAcquisitionService.cs` full logic for both font slots — for each of NotoSansJP and NotoSerifJP: (1) check `{dataDir}/fonts/custom-font-sans.ttf` / `custom-font-serif.ttf` → use if present; (2) check `{dataDir}/fonts/NotoSansJP.ttf` / `NotoSerifJP.ttf` + SHA-256 checksum → use if valid; (3) download from respective Google Fonts URL, verify SHA-256, write checksum; (4) on failure: set corresponding path to null and log actionable error with manual-install instructions; expose `string? NotoSansPath` and `string? NotoSerifPath` properties in `src/JellyfinRecents.Plugin/Services/FontAcquisitionService.cs`
- [ ] T033 [P] [US6] Implement `font_manager.rs`: load TTF/OTF from `--font-path` arg into `cosmic_text::FontSystem`; if path is absent or invalid, fall back to built-in minimal bitmap font and log warning in `src/poster-gen/src/font_manager.rs`
- [ ] T034 [US6] Implement `text_renderer.rs`: define 5 colour theme structs (classic/dark/light/cinematic/minimal — header background RGBA, text colour, accent colour, timestamp badge background + text colour); use `cosmic_text` to layout branding label (top-right, truncated with ellipsis per FR-020) and video metadata block (top-left, per-line visibility flags); when `--show-timestamp` flag is set, render per-cell HH:MM:SS badge (bottom-left of each cell) using theme badge colours; blit all rendered glyphs onto `RgbImage` buffer in `src/poster-gen/src/text_renderer.rs` (depends on T033)
- [ ] T035 [US6] Wire `text_renderer.rs` into `image_stitcher.rs`: call `render_overlay(&mut grid_image, &media_info, &overlay_cfg)` after grid assembly, before JPEG encode in `src/poster-gen/src/image_stitcher.rs` (depends on T034)
- [ ] T036 [US6] Wire all overlay CLI flags through the full stack: `--branding-text`, `--no-branding`, `--no-video-info`, per-line `--no-*` flags, `--color-theme {value}`, `--show-timestamp`; map from `main.rs` parsed args into `text_renderer` config; update `PosterSheetJobService.cs` to build all CLI args from `OverlaySettings` including `ColorTheme`, `FontFamily` (resolved to file path via `FontAcquisitionService.NotoSansPath` / `NotoSerifPath`), and `ShowFrameTimestamp` in `src/poster-gen/src/main.rs` + `src/JellyfinRecents.Plugin/Services/PosterSheetJobService.cs` (depends on T034)
- [ ] T037 [US6] Add overlay settings section to `PosterSheetSettingsPanel.tsx`: branding label toggle + text input (max 200 chars), video info master toggle, per-line checkboxes, per-frame timestamp toggle (default OFF); colour theme radio picker (5 options with theme name labels); font family selector (Noto Sans / Noto Serif — each label rendered in its own typeface as live preview); **Preview** button (calls `POST /preview` endpoint via posterSheetApi.ts, see T050, displays returned JPEG inline below settings); load/persist all settings to `jr-poster-overlay` localStorage key as JSON in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T025)

**Checkpoint**: Configurable text overlays baked into generated sheets; CJK renders correctly; changing settings produces a new cache entry.

---

## Phase 7: User Story 4 — Deterministic vs. Random Mode (Priority: P3)

**Goal**: Deterministic mode (default) produces cache-eligible identical sheets for same video+settings; random mode produces fresh sheets with different frame timestamps each time.

**Independent Test**: Generate same video twice in deterministic mode → files are identical (second request is cache hit, served in ≤1 s). Switch to random mode → generate twice → different frame timestamps visible in each sheet; no two adjacent frames are duplicates.

### Implementation for User Story 4

- [ ] T038 [P] [US4] Implement deterministic seed in `main.rs`: compute `seed = hex(SHA-256(itemId))[..16]`; derive per-frame timestamps as evenly spaced without jitter; same seed always produces same timestamps in `src/poster-gen/src/main.rs`
- [ ] T039 [P] [US4] Implement random mode in `main.rs`: accept GUID seed from `--seed` arg; add per-frame jitter in `(-spacing/4, +spacing/4)` range ensuring adjacent frames remain ≥2 s apart in `src/poster-gen/src/main.rs` (depends on T038)
- [ ] T040 [US4] Add mode toggle to `PosterSheetSettingsPanel.tsx` (Deterministic / Random radio); in random mode, generate a UUID seed client-side and pass it in the `startJob()` request body; in deterministic mode omit seed (server computes from itemId); persist `jr-poster-mode` to localStorage in `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T025)

**Checkpoint**: Deterministic sheets hit cache on repeat; random mode skips cache and generates fresh each time.

---

## Phase 8: User Story 5 — Large Video Handling (Priority: P3)

**Goal**: 4K video generation completes within 90 s for 6×8 grid; server memory spike does not exceed 500 MB above baseline.

**Independent Test**: Run generation on a 4K test file (e.g., 3840×2160) → completes in ≤90 s; Jellyfin process memory does not increase by more than 500 MB during generation.

### Implementation for User Story 5

- [ ] T041 [US5] Cap concurrent ffmpeg processes in `main.rs` via `rayon::ThreadPoolBuilder::new().num_threads(N).build_global()` (e.g., N=4) to prevent simultaneous 4K frame decodes from exhausting memory; tune N based on `--thumb-width` target resolution in `src/poster-gen/src/main.rs`
- [ ] T042 [US5] Verify `frame_extractor.rs` uses `-vf scale={thumb_width}:-1` ffmpeg filter for all frame extractions (reduces per-frame peak memory from ~25 MB to ~0.4 MB at width=320); document the tuning rationale in a comment in `src/poster-gen/src/frame_extractor.rs`

**Checkpoint**: 4K generation completes within time budget without server crash.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, edge cases, build pipeline, integration verification.

- [ ] T043 [P] Implement error state in `PosterSheetOverlay.tsx`: when `status = "error"` display `job.error` message text and a "Retry" button that re-calls `startJob()` in `src/frontend/src/components/PosterSheetOverlay.tsx`
- [ ] T044 [P] Add `422 Unprocessable Entity` response in `PosterSheetController.cs` POST handler when item has no video stream; verify `PlayRecordCard.tsx` hides poster button for audio-only items (where `videoDuration === null`) in `src/JellyfinRecents.Plugin/Api/PosterSheetController.cs` + `src/frontend/src/components/PlayRecordCard.tsx`
- [ ] T045 Write C# xUnit tests for `PosterSheetJobService`: job lifecycle (Queued → Running → Done state transitions), cancellation (CancellationToken propagates to process kill), progress update via `Interlocked.Exchange` in `src/JellyfinRecents.Plugin.Tests/PosterSheetJobServiceTests.cs`
- [ ] T046 [P] Write C# xUnit API endpoint integration tests: `POST` returns `202` with `jobId`, `GET /status` returns correct JSON shape, `POST` with invalid grid returns `400`, `POST` for audio-only item returns `422` in `src/JellyfinRecents.Plugin.Tests/PosterSheetControllerTests.cs`
- [ ] T047 Add cross-compilation build step for Rust: `cargo build --release --target x86_64-unknown-linux-gnu` and `x86_64-pc-windows-msvc`; copy outputs to plugin directory; document build command in `src/JellyfinRecents.Plugin/JellyfinRecents.Plugin.csproj` or a `build.ps1` script
- [ ] T048 End-to-end smoke test with performance validation (manual): (1) unlock via 7-click easter egg within 5 s window; (2) generate 6×8 sheet for 1080p test video — **measure wall-clock time, must be ≤30 s (SC-001)**; (3) verify progress counter appears within 3 s of generation start (SC-003); (4) trigger same video+settings again — **must return cached result within 1 s (SC-004)**; (5) verify completed sheet shows branding label and configured overlay; (6) verify closing overlay mid-generation cancels the job; (7) optionally repeat step 2 with a 4K test file — **must complete ≤90 s (SC-002)**
- [ ] T049 [P] Implement `poster-gen preview` subcommand: extract logic to `src/poster-gen/src/preview.rs`; generate a 400×270 px JPEG showing a 3×2 grid of solid-colour placeholder cells with full overlay rendered (theme colours, font, branding text, per-line flags, timestamp badge) using sample/hardcoded metadata; accepts same overlay flags as generate subcommand; no ffmpeg call; prints `DONE {path}` or `ERROR {msg}` to stdout in `src/poster-gen/src/preview.rs` + `src/poster-gen/src/main.rs` (depends on T034)
- [ ] T050 Add `POST /JellyfinRecents/PosterSheet/preview` endpoint in `PosterSheetController.cs`: receive overlay settings body, build CLI args, spawn `poster-gen preview` synchronously (timeout 5 s), stream resulting JPEG as `image/jpeg` response; return `503` if binary unavailable (fonts not yet ready); update `PosterSheetSettingsPanel.tsx` to call this endpoint on Preview button click and display the returned `<img>` inline in the settings panel in `src/JellyfinRecents.Plugin/Api/PosterSheetController.cs` + `src/frontend/src/components/PosterSheetSettingsPanel.tsx` (depends on T049)

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

## Notes

- `[P]` = different files, no dependencies on incomplete tasks within the same phase
- `[US#]` label maps task to spec.md user story number for traceability
- Rust binary must be cross-compiled separately; `cargo build --release` is not part of `dotnet build`
- `FontAcquisitionService.StartAsync` must be non-blocking — run font download as a background `Task` and not `await` it synchronously
- In deterministic mode, the cache key (`{itemId}_{rows}x{cols}_{seed}_{overlayHash}.jpg`) is stable across restarts; a cache hit avoids any Rust invocation
- The 7-click easter egg is wired to the **poster-view toolbar button** (海报视图, the view-switcher in App.tsx), not to the per-card poster sheet button
- `OverlayHash` = first 8 chars of SHA-256(JSON of `OverlaySettings`); must be computed identically in both C# (cache filename) and Rust (for verification)
