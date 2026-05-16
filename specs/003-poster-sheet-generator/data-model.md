# Data Model: Video Thumbnail Sheet Generator

**Branch**: `003-poster-sheet-generator` | **Date**: 2026-05-14

---

## Existing Entity Changes

### PlayRecord *(extended)*

Adds one nullable field to the existing play history response DTO:

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `videoDuration` | `float` | Yes | Total video duration in seconds. `null` for audio-only items. Sourced from Jellyfin's `RunTimeTicks` (`÷ 10_000_000`). |

No database schema change required — `RunTimeTicks` is already stored by Jellyfin; the field is projected at query time.

---

## New Entities

### PosterSheetJob *(in-memory only)*

Managed by `PosterSheetJobService` (`IHostedService`). Not persisted; ephemeral per server process lifetime.

| Field | Type | Notes |
|-------|------|-------|
| `Id` | `string` (UUID) | Unique job identifier |
| `ItemId` | `string` | Jellyfin item ID; used as dictionary key (one job per item at a time) |
| `Rows` | `int` | 1–10 |
| `Cols` | `int` | 1–12 |
| `Mode` | `enum` | `Deterministic` \| `Random` |
| `Seed` | `string` | Deterministic: SHA-256(ItemId)\[:16]; Random: GUID |
| `OverlaySettings` | `OverlaySettings` | Snapshot at job creation time |
| `Status` | `enum` | `Queued` → `Running` → `Done` \| `Error` \| `Cancelled` |
| `Progress` | `int` | Frames captured so far |
| `Total` | `int` | Total frames to capture (rows × cols) |
| `OutputPath` | `string?` | Absolute path to cached JPEG; set on `Done` |
| `MediaInfo` | `MediaInfo?` | Extracted by Rust binary; set on `Done` |
| `Error` | `string?` | Human-readable error; set on `Error` status |
| `Cts` | `CancellationTokenSource` | For cancellation; killed = process terminated |
| `CreatedAt` | `DateTime` | UTC |

**Key invariant**: `ConcurrentDictionary` key is `ItemId`. `GetOrAdd` ensures at most one active job per item. A new job request while an existing job is `Done` or `Error` creates a fresh entry (replaces old).

---

### OverlaySettings *(value object)*

Stored as a JSON snapshot inside `PosterSheetJob` and included in the cache filename hash.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `BrandingEnabled` | `bool` | `true` | Show top-right branding label |
| `BrandingText` | `string` | `"Jellyfin Recents"` | Empty string = no label rendered |
| `VideoInfoEnabled` | `bool` | `true` | Master toggle for entire top-left block |
| `ShowFileSize` | `bool` | `true` | |
| `ShowResolutionFps` | `bool` | `true` | e.g. "1920×1080, 23.976 fps" |
| `ShowVideoEncoding` | `bool` | `true` | codec, bit depth, HDR type, colour space |
| `ShowAudioEncoding` | `bool` | `true` | codec, format, bitrate, track count |
| `ShowDuration` | `bool` | `true` | HH:MM:SS |
| `ShowFrameTimestamp` | `bool` | `false` | Per-thumbnail HH:MM:SS badge (bottom-left of each cell) |
| `ColorTheme` | `enum` | `"classic"` | `"classic"` \| `"dark"` \| `"light"` \| `"cinematic"` \| `"minimal"` |
| `FontFamily` | `enum` | `"noto-sans"` | `"noto-sans"` \| `"noto-serif"` — both dynamically acquired, CJK-capable |

`OverlayHash` = first 8 chars of SHA-256(JSON-serialise(OverlaySettings)).

---

### MediaInfo *(value object, populated by Rust binary)*

Returned in job status API response after successful generation.

| Field | Type | Nullable | Example |
|-------|------|----------|---------|
| `Filename` | `string` | No | `"Space-1999.S01E01.avi"` |
| `FileSize` | `string` | No | `"352 MB"` (human-readable) |
| `FileSizeBytes` | `long` | No | `369_627_136` |
| `Resolution` | `string` | No | `"512×384"` |
| `Fps` | `double` | No | `23.976` |
| `VideoCodec` | `string` | No | `"H.264"` |
| `BitDepth` | `int?` | Yes | `10` (null if unknown) |
| `HdrType` | `string?` | Yes | `"HDR10"` \| `"Dolby Vision"` \| `null` |
| `ColourSpace` | `string?` | Yes | `"yuv420p10le"` |
| `AudioCodec` | `string?` | Yes | `"AAC"` |
| `AudioFormat` | `string?` | Yes | `"stereo"` |
| `AudioBitrate` | `string?` | Yes | `"192 kbps"` |
| `AudioTracks` | `int` | No | `1` |
| `Duration` | `string` | No | `"00:50:03"` |

---

### CachedPosterSheet *(filesystem)*

No database table. Cache entry = JPEG file at:

```
{pluginDataDir}/poster-cache/{itemId}_{rows}x{cols}_{seed}_{overlayHash}.jpg
```

Existence check via `File.Exists`. No eviction in v1.

---

## Rust Binary CLI Contract

The Rust binary supports two subcommands: `generate` (default, omittable) for sheet generation, and `preview` for generating theme preview images.

### Preview subcommand

Accepts the same overlay flags as the generate subcommand but requires no video file; produces a small preview JPEG synchronously using solid-colour placeholder cells.

```
poster-gen-linux-x64 preview \
  --color-theme  <theme>           # one of: classic dark light cinematic minimal
  --font-path    <path>            # resolved by C# from fontFamily setting
  --output       <output-path>     # path for the generated preview JPEG
  [--branding-text  "Jellyfin Recents"]
  [--no-branding]
  [--no-video-info]
  [--no-file-size]
  [--no-resolution-fps]
  [--no-video-encoding]
  [--no-audio-encoding]
  [--no-duration]
  [--show-timestamp]
```

Output: a small JPEG (~400×270 px) showing a 3×2 grid of solid-colour placeholder cells with the full overlay rendered using sample text (fixed sample filename, hardcoded metadata values). No ffmpeg invocation. Prints `DONE {path}` to stdout on success, `ERROR {msg}` on failure.

### Generate subcommand

The C# plugin spawns the Rust binary as:

```
poster-gen-linux-x64 \
  --ffmpeg-path  <path>          # from IMediaEncoder
  --input        <video-path>
  --output       <output-path>
  --rows         <int>
  --cols         <int>
  --seed         <string>
  --font-path    <path>          # resolved by C# from FontFamily + FontAcquisitionService
  --thumb-width  320
  [--color-theme  "classic"|"dark"|"light"|"cinematic"|"minimal"]
  [--show-timestamp]
  [--branding-text  "Jellyfin Recents"]
  [--no-branding]
  [--no-video-info]
  [--no-file-size]
  [--no-resolution-fps]
  [--no-video-encoding]
  [--no-audio-encoding]
  [--no-duration]
```

**Stdout protocol** (one line per event, C# reads with `ReadLineAsync`):

```
PROGRESS 1/48
PROGRESS 2/48
...
MEDIA_INFO {"filename":"...","resolution":"512x384","fps":23.976,...}
PROGRESS 48/48
DONE /absolute/path/to/output.jpg
```

On error:

```
ERROR <human-readable message>
```

Exit code: `0` = success, `1` = error, `2` = cancelled (process killed by C#).

---

## Frontend State

### PosterSheetUnlockState *(localStorage)*

| Key | Value | Notes |
|-----|-------|-------|
| `jr-poster-unlocked` | `"1"` | Present = feature unlocked |

### PosterSheetSettings *(localStorage, merged into existing viewSettings)*

| Key | Type | Default |
|-----|------|---------|
| `jr-poster-rows` | `number` | `6` |
| `jr-poster-cols` | `number` | `8` |
| `jr-poster-mode` | `"deterministic"\|"random"` | `"deterministic"` |
| `jr-poster-overlay` | `OverlaySettings JSON` | all enabled, branding = "Jellyfin Recents" |
