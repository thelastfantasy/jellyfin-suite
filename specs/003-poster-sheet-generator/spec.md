# Feature Specification: Video Thumbnail Sheet Generator

**Feature Branch**: `003-poster-sheet-generator`  
**Created**: 2026-05-14  
**Status**: Draft  
**Input**: User description: "MPC-style video thumbnail sheet generator — extract frames at intervals, stitch into a configurable grid with timestamps, progress reporting, frontend overlay display, short-video limits, optional random offset, efficient large-video support"

## Clarifications

### Session 2026-05-14

- Q: Where does technical media metadata (codec, HDR, FPS, bitrate, track count) for the left overlay come from? → A: The video processing binary extracts it directly from the video file at generation time; the extracted metadata is returned as part of the job status API response and used when rendering the overlay.
- Q: Are overlay texts (branding label, video info) baked into the image server-side, or applied by the frontend at display time? → A: Baked into the image at generation time (server-side); the output is a self-contained image file. Changing overlay settings requires re-generation. Overlay settings are part of the cache key.
- Q: Where in the UI is the thumbnail sheet generation triggered, and how is the feature surfaced to users? → A: The trigger button appears in the card's top-left corner, integrated with the existing folder-view icon into a unified toolbar. The feature is hidden by default — unlocked by clicking the poster-view button 7 times within a 5-second window; the poster-view button carries a hint (e.g., title/aria-label "click me 7 times"). The unlocked state is persisted in localStorage.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Generate Thumbnail Sheet for a Video (Priority: P1)

A user viewing the "Recently Played" list wants to visually preview the contents of a specific video at a glance, like a contact sheet. They trigger generation from the video card, wait for the sheet to be created, and view it in a full-screen overlay.

**Why this priority**: Core feature value. Without this, nothing else in the feature has meaning.

**Independent Test**: Can be fully tested by triggering generation on any single video with default settings (e.g., 6 rows × 8 columns) and confirming a correctly laid-out grid image appears in the overlay.

**Acceptance Scenarios**:

1. **Given** the hidden feature has been unlocked and a video card is displayed, **When** the user clicks the thumbnail sheet button in the card's top-left toolbar (alongside the folder-view icon), **Then** a progress overlay appears immediately and sheet generation begins in the background without freezing the UI.
2. **Given** generation is in progress, **When** frames are captured, **Then** the overlay shows a progress indicator (e.g., "12 / 48 frames captured") updating in real time.
3. **Given** generation completes successfully, **When** the final sheet is ready, **Then** the overlay transitions to display the full thumbnail sheet image; the sheet contains evenly-spaced frame captures with a timestamp label on each thumbnail.
4. **Given** a previously generated sheet exists for the same video with the same settings, **When** the user requests generation again, **Then** the cached result is shown instantly without re-processing.

---

### User Story 2 — Configure Grid Size (Priority: P2)

The user wants control over how dense or sparse the thumbnail grid is, trading off detail vs. file size and generation time.

**Why this priority**: Different use cases demand different densities (quick overview vs. detailed scrub). Without this, the feature is less useful.

**Independent Test**: Can be tested independently by changing the rows/columns sliders and verifying the generated sheet reflects the chosen dimensions.

**Acceptance Scenarios**:

1. **Given** the generation dialog is open, **When** the user adjusts the number of rows (1–10) and columns (1–12), **Then** a preview of the expected total frame count (rows × cols) updates dynamically.
2. **Given** the user confirms generation with custom dimensions, **When** the sheet is produced, **Then** it contains exactly rows × cols thumbnails arranged in the specified grid layout.
3. **Given** the settings are saved between sessions, **When** the user returns later, **Then** their last-used row/column values are pre-filled.

---

### User Story 3 — Short Video Safeguard (Priority: P2)

For short videos (under 2 minutes), requesting a large grid would result in nearly identical or overlapping frames. The frontend enforces a preset-based constraint before the user can submit, and the server validates again as a safeguard.

**Why this priority**: Without this guardrail, short clips produce meaningless repeated-frame grids; the validation must also prevent invalid API calls.

**Independent Test**: Can be tested independently by opening the generation dialog for a video under 2 minutes and confirming that only the permitted grid presets are selectable.

**Acceptance Scenarios**:

1. **Given** the video duration is under 2 minutes, **When** the generation dialog opens, **Then** only permitted grid presets are available for selection (e.g., 2×4, 3×3, 4×2 — any preset whose total frame count does not violate the minimum 2-second spacing rule for that duration); free-entry of arbitrary rows/cols is disabled.
2. **Given** the user selects a permitted preset for a short video, **When** the sheet is generated, **Then** all thumbnails are spaced at least 2 seconds apart.
3. **Given** a video's duration is already known when the Recently Played list loads, **When** the user opens the generation dialog, **Then** the constraint is applied immediately without an additional network round-trip (duration is available in the play history API response).
4. **Given** an invalid grid is submitted to the server (e.g., via direct API call), **When** the server validates the request, **Then** it rejects it with a clear error describing the maximum allowed frame count for the given duration.

---

### User Story 6 — Overlay Text and Branding Customization (Priority: P2)

The sheet image can carry two optional text overlays: a branding label in the top-right corner (e.g., "Jellyfin Recents", like MPC's "Media Player Classic" watermark) and video metadata in the top-left corner (filename, resolution, file size, duration). Each can be independently hidden; hiding both produces a clean thumbnail grid with no text.

**Why this priority**: The watermark is part of the MPC-style visual identity; video info is useful for archival purposes. Both must be opt-out rather than opt-in because they add value by default.

**Independent Test**: Can be tested independently by toggling the two overlay options in settings and confirming the generated sheet reflects the chosen visibility state.

**Acceptance Scenarios**:

1. **Given** both overlays are enabled (default), **When** a sheet is generated, **Then** the top-right corner displays the branding label and the top-left corner displays the video metadata block. The block always leads with the filename; each subsequent line is independently controlled by the user's settings and may include: file size, resolution + frame rate, video encoding details (codec, bit depth, HDR flag, colour space), audio encoding details (codec, format, bitrate, track count), and total duration.
2. **Given** the user customises the branding label text (e.g., changes "Jellyfin Recents" to their name or an empty string), **When** the sheet is generated, **Then** the top-right corner displays the custom text; if the text is empty, no branding area is rendered.
3. **Given** the video info overlay is disabled, **When** the sheet is generated, **Then** the top-left corner is blank.
4. **Given** both overlays are disabled, **When** the sheet is generated, **Then** the output contains only the thumbnail grid with per-frame timestamps — no header text of any kind.
5. **Given** the branding label contains CJK characters (Chinese, Japanese, Korean), **When** the sheet is generated, **Then** the characters render correctly without tofu (missing glyph boxes).
6. **Given** the user selects a colour theme and/or adjusts any overlay setting, **When** the user clicks the Preview button in the settings panel, **Then** a small preview image is generated and displayed inline; the preview uses the current settings and solid-colour placeholder cells in place of actual frames, reflecting the chosen theme, font, and overlay text accurately.
7. **Given** the user selects "Noto Serif JP" as the font family, **When** the sheet is generated, **Then** all overlay text is rendered in a serif typeface; the font selector in the settings panel displays each option's name in its own typeface.
8. **Given** the per-frame timestamp toggle is enabled, **When** the sheet is generated, **Then** each thumbnail cell displays an HH:MM:SS badge in the bottom-left corner; **Given** the toggle is disabled (default), **Then** no timestamp badge appears on any cell.

---

### User Story 4 — Deterministic vs. Random Frame Selection (Priority: P3)

By default, the same video with the same grid settings always produces the same sheet (deterministic). Optionally, the user can enable randomised offsets to get a fresh, different sheet each time.

**Why this priority**: Determinism is the safer default; randomness is a power-user option.

**Independent Test**: Can be tested independently by generating the same sheet twice with deterministic mode and confirming the sheets are pixel-identical, then enabling random mode and confirming successive sheets differ.

**Acceptance Scenarios**:

1. **Given** deterministic mode is active (default), **When** the user generates a sheet for the same video with the same grid size twice, **Then** both sheets are identical.
2. **Given** random mode is enabled, **When** the user generates the sheet multiple times, **Then** each generation produces a visibly different set of frame timestamps; the variation is bounded so no two adjacent frames overlap.

---

### User Story 5 — Large Video Handling (Priority: P3)

4K or otherwise high-resolution video files should not cause the server to run out of memory or produce unacceptably slow generation times.

**Why this priority**: Without this, the feature degrades badly on large content.

**Independent Test**: Can be tested independently by running generation against a 4K test file and confirming completion within the time budget with no server crash.

**Acceptance Scenarios**:

1. **Given** a 4K video file is selected, **When** generation is triggered, **Then** the server processes it without exhausting available memory and completes within the time budget defined in Success Criteria.
2. **Given** the generated thumbnails are displayed, **When** the sheet image is inspected, **Then** individual frames are readable (not blurry or corrupt) even though internal decoding used a reduced resolution.

---

### Edge Cases

- What happens when the video file is missing or inaccessible at generation time?
- What happens if the user closes the overlay mid-generation?
- What happens if a second generation request arrives while one is already running for the same item?
- What if disk space for caching is exhausted?
- What happens for videos with no video stream (audio-only files)?
- What if the branding label text is extremely long — does it wrap, truncate, or overflow?
- What if the video metadata (filename, resolution) contains characters from multiple scripts in a single string?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The thumbnail sheet generation feature is hidden by default. It is unlocked exclusively by clicking the poster-view button in the main toolbar exactly 7 consecutive times; the poster-view button MUST carry a discoverable hint (e.g., `title` or `aria-label` attribute with text such as "click me 7 times"). Once unlocked, the state MUST be persisted in localStorage and survive page reloads. When unlocked, a thumbnail sheet trigger button MUST appear in the top-left corner of each video card, integrated with the existing folder-view icon into a single unified toolbar component.
- **FR-002**: The system MUST allow users to configure the grid dimensions (rows and columns) within defined bounds (rows: 1–10, columns: 1–12); for videos under 2 minutes, only permitted presets (those satisfying the minimum spacing rule for that duration) MUST be available in the UI — free-entry of arbitrary dimensions MUST be disabled.
- **FR-003**: The system MUST enforce a minimum spacing of 2 seconds between captured frames both at the UI validation layer (preventing invalid submissions) and at the server validation layer (rejecting invalid API requests); when the requested grid would violate this, the server MUST return a descriptive error indicating the maximum allowed frame count.
- **FR-004**: The system MUST report generation progress as a frame counter (e.g., "N of M frames captured") visible in the UI overlay.
- **FR-005**: Generation MUST run entirely in the background; the UI MUST remain fully interactive during generation.
- **FR-006**: The system MUST display the completed thumbnail sheet in a full-screen overlay within the Jellyfin web UI.
- **FR-007**: Each thumbnail cell MAY optionally display a per-frame timestamp badge (HH:MM:SS format) in the bottom-left corner of the cell. This option MUST be independently toggleable and MUST default to OFF.
- **FR-008**: The system MUST cache generated sheets; a repeat request for the same video with identical settings MUST return the cached result without re-processing.
- **FR-009**: In deterministic mode (default), the same video + same grid settings MUST always produce the same sheet.
- **FR-010**: In random mode (user-selected), each generation MUST produce a sheet with a different set of frame timestamps, with frames spaced at least 2 seconds apart.
- **FR-011**: The system MUST handle audio-only media items gracefully: the generation option MUST NOT be shown for items with no video stream.
- **FR-012**: The system MUST handle generation errors (inaccessible file, corrupt video) by displaying a clear error message in the overlay and allowing the user to retry.
- **FR-013**: If the user dismisses the overlay during generation, the background job MUST be cancelled and any partial output discarded.
- **FR-014**: The system MUST prevent duplicate concurrent generation jobs for the same item; if a job is already running, a second trigger MUST attach to the existing job's progress.
- **FR-021**: The folder-view icon and the thumbnail sheet trigger button MUST be presented as a single unified toolbar component in the top-left corner of the video card; they MUST share consistent styling and spacing.
- **FR-022**: The 7 clicks MUST be completed within a 5-second window; if the window elapses before 7 clicks are registered, the counter resets to zero. The counter also resets if the user navigates away from the page.
- **FR-015**: The generated sheet MUST support an optional top-right branding label; by default it displays "Jellyfin Recents". The user MUST be able to customise the label text or hide it entirely via plugin settings.
- **FR-016**: The generated sheet MUST support an optional top-left video metadata block. When enabled, the block MUST always display the filename as its first line. Each of the following lines MUST be independently toggleable (shown or hidden per user preference):
  - File size
  - Resolution and frame rate (e.g., "1920×1080, 23.976 fps")
  - Video stream encoding details: codec name, bit depth (e.g., "10-bit"), HDR flag (e.g., "HDR10", "Dolby Vision"), colour space
  - Audio stream details: codec, format, bitrate, number of audio tracks
  - Total duration
  The entire block (including the filename) MUST be hideable as a single toggle. All label text is rendered in English in v1; i18n support is deferred to v2.
- **FR-017**: Each of the two text overlays (branding label, video metadata) MUST be independently toggleable; when both are disabled the sheet output MUST contain no header text whatsoever.
- **FR-018**: The text rendering subsystem MUST correctly display CJK characters (Chinese, Japanese, Korean) in all overlay regions without missing glyphs ("tofu boxes"). All selectable font family options (see FR-024) MUST be CJK-capable. The plugin MUST ensure the user's selected font is available before rendering without requiring manual user action. If the selected font is absent, the plugin MUST attempt to acquire it automatically (download on first use, cache in plugin data directory, verify SHA-256 checksum). If acquisition fails (e.g., no outbound network access), the plugin MUST surface a clear, actionable message explaining the font is unavailable and describing the manual-install fallback (placing a compatible font file in the designated directory).
- **FR-019**: The play history API response MUST include the video duration for each record so the frontend can enforce short-video grid constraints without an additional network request. All other technical media metadata (codec, HDR, resolution, FPS, audio details) is extracted by the video processing binary at generation time and returned via the job status API; it is NOT required in the play history response.
- **FR-020**: The branding label text MUST be truncated (with an ellipsis) if it exceeds the available width of the top-right region; it MUST NOT overflow onto the thumbnail grid.
- **FR-023**: The system MUST provide exactly 5 preset colour themes — classic, dark, light, cinematic, minimal — governing the visual style of all overlay regions (header background colour, text colour, accent colour, and per-frame timestamp badge). The settings panel MUST include a **Preview** button; when clicked, the system generates a small preview image reflecting the user's current overlay settings (colour theme, font family, branding text, all toggle states) using solid-colour placeholder cells in place of actual video frames, and displays the result inline within the settings panel. The preview reuses the Rust binary's dedicated preview subcommand and does not require an ffmpeg call or a full generation job. The selected colour theme MUST be included in the overlay cache key; changing the theme requires re-generation.
- **FR-024**: The user MUST be able to select the font family used for all overlay text from at least two options: Noto Sans JP and Noto Serif JP. The settings panel MUST render each option's label in its respective typeface as a live preview. Both fonts MUST be acquired dynamically under the same rules as FR-018; a custom font file placed in the designated directory overrides the selected option for that slot.

### Key Entities

- **ThumbnailSheetJob**: Represents an in-progress or completed generation task. Attributes: item ID, grid dimensions (rows × cols), frame-selection mode (deterministic/random), seed value, status (queued/running/done/error), progress (captured/total), result image path, extracted media metadata (populated on completion: video codec, bit depth, HDR type, colour space, resolution, FPS, audio codec, audio format, bitrate, track count, file size, duration).
- **ThumbnailSheet**: The generated output — a self-contained image file with all text overlays baked in. Attributes: item ID, grid dimensions, seed, overlay settings snapshot (branding label text, branding visible, video-info per-line visibility flags), image file path, file size, creation timestamp. Uniquely identified by (item ID, rows, cols, seed, overlay settings snapshot). Changing any overlay setting produces a distinct cache entry requiring a new generation.
- **FrameSpec**: A single scheduled capture. Attributes: index (1-based), target timestamp (seconds), actual captured timestamp.
- **OverlaySettings**: User-configured rendering preferences. Attributes: branding label enabled (bool), branding label text (string, default "Jellyfin Recents"), video info enabled (bool — master toggle for the entire top-left block), per-line visibility flags for: file size, resolution+fps, video encoding (codec/bit-depth/HDR/colour-space), audio encoding (codec/format/bitrate/track-count), duration; per-frame timestamp badge enabled (bool, default false); colour theme (enum: "classic" / "dark" / "light" / "cinematic" / "minimal", default "classic"); font family (enum: "noto-sans" / "noto-serif", default "noto-sans").
- **PlayRecord** *(extended)*: The existing play history record entity gains a `videoDuration` attribute (total duration in seconds) to support client-side grid validation without additional API calls.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Thumbnail sheet generation for a standard 1080p video (any duration) completes within 30 seconds for a 6×8 grid.
- **SC-002**: Thumbnail sheet generation for a 4K video completes within 90 seconds for a 6×8 grid.
- **SC-003**: Progress updates are visible in the UI within 3 seconds of the first frame being captured.
- **SC-004**: Cached results are served within 1 second of the user's second request for an identical sheet.
- **SC-005**: The generation process does not cause the Jellyfin server's memory usage to spike by more than 500 MB above baseline.
- **SC-006**: 100% of audio-only media items show no thumbnail sheet generation option.
- **SC-007**: Once the feature has been unlocked via the easter egg, users can configure settings and trigger generation without reading documentation (task completion rate ≥ 90% on first attempt post-unlock).

## Assumptions

- The feature targets the Jellyfin web UI only; mobile clients are out of scope for v1.
- The Jellyfin server environment has access to a video processing tool capable of seeking and decoding arbitrary video formats (same tool already used by Jellyfin for transcoding).
- Generated sheet images are stored on the server filesystem in the plugin's data directory; no external storage or CDN is required.
- Grid bounds (1–10 rows, 1–12 cols) are informed by practical screen real estate; they may be adjusted based on user feedback post-v1.
- A minimum inter-frame spacing of 2 seconds is a reasonable floor; this assumption may be revisited for content with extremely fast scene changes.
- For videos under 2 minutes, the set of permitted presets is determined by the 2-second spacing rule applied to the video's actual duration; the exact preset list is a planning-phase detail.
- Cache invalidation is not required in v1: cached sheets are never automatically regenerated (manual re-trigger with different settings creates a new entry). Overlay settings are part of the cache key, so changing label text or visibility produces a new sheet.
- The user triggering generation is always the currently logged-in Jellyfin user; no cross-user sheet sharing is required.
- Sheet images are generated at a fixed thumbnail size (configurable in v2); v1 uses a fixed width per thumbnail (e.g., comparable to a DVD cover) to keep output file size predictable.
- Two CJK-capable font options (Noto Sans JP and Noto Serif JP) are available for selection; both are acquired dynamically rather than bundled. The plugin checks the plugin data directory for each font at startup and downloads any that are absent; downloaded fonts are cached and verified via SHA-256 checksum. Air-gapped environments are supported by a manual fallback: placing a compatible font file in a designated slot-specific directory (e.g., `custom-font-sans.ttf` / `custom-font-serif.ttf`). Both fonts must be open-source and permissively licensed (SIL OFL or Apache 2.0); specific download URLs are an implementation-phase decision.
- The play history API already returns item metadata; adding `videoDuration` is a backward-compatible additive change to the existing response schema.
- Overlay settings (branding label text/visibility, video info visibility) are stored per-user in the plugin's settings alongside other view preferences.
