# API Contracts: Video Thumbnail Sheet Generator

**Base path**: `/JellyfinRecents/PosterSheet`  
**Auth**: All endpoints require Jellyfin session cookie (same as existing plugin endpoints).

---

## POST `/JellyfinRecents/PosterSheet/{itemId}`

Start a thumbnail sheet generation job. If a job is already running for this item, returns the existing job ID without starting a new one.

**Path params**:
| Param | Type | Description |
|-------|------|-------------|
| `itemId` | string | Jellyfin item ID |

**Request body** (`application/json`):
```json
{
  "rows": 6,
  "cols": 8,
  "mode": "deterministic",
  "overlay": {
    "brandingEnabled": true,
    "brandingText": "Jellyfin Recents",
    "videoInfoEnabled": true,
    "showFileSize": true,
    "showResolutionFps": true,
    "showVideoEncoding": true,
    "showAudioEncoding": true,
    "showDuration": true,
    "showFrameTimestamp": false,
    "colorTheme": "classic",
    "fontFamily": "noto-sans"
  }
}
```

**Validation**:
- `rows`: 1–10 (inclusive)
- `cols`: 1–12 (inclusive)
- `rows × cols ≥ 1`
- `rows × cols` must satisfy minimum 2-second spacing for the item's duration (server re-validates even if frontend already checked)
- `brandingText`: max 200 characters

**Responses**:

`202 Accepted` — job created or existing job returned:
```json
{ "jobId": "a1b2c3d4-..." }
```

`400 Bad Request` — validation failure:
```json
{ "error": "Grid too large for video duration. Maximum 12 frames (2s spacing). Requested: 48." }
```

`404 Not Found` — item does not exist or user lacks access.

`422 Unprocessable Entity` — item has no video stream (audio-only):
```json
{ "error": "Item has no video stream." }
```

---

## GET `/JellyfinRecents/PosterSheet/{jobId}/status`

Poll job status and progress.

**Responses**:

`200 OK` — job found:
```json
{
  "jobId": "a1b2c3d4-...",
  "itemId": "911f5b1f-...",
  "status": "running",
  "progress": 12,
  "total": 48,
  "error": null,
  "mediaInfo": null
}
```

When `status` is `"done"`:
```json
{
  "jobId": "a1b2c3d4-...",
  "itemId": "911f5b1f-...",
  "status": "done",
  "progress": 48,
  "total": 48,
  "error": null,
  "mediaInfo": {
    "filename": "Space-1999.S01E01.avi",
    "fileSize": "352 MB",
    "fileSizeBytes": 369627136,
    "resolution": "512×384",
    "fps": 23.976,
    "videoCodec": "H.264",
    "bitDepth": null,
    "hdrType": null,
    "colourSpace": "yuv420p",
    "audioCodec": "AAC",
    "audioFormat": "stereo",
    "audioBitrate": "192 kbps",
    "audioTracks": 1,
    "duration": "00:50:03"
  }
}
```

`status` enum values: `"queued"` | `"running"` | `"done"` | `"error"` | `"cancelled"`

`404 Not Found` — job ID not found (expired or never existed).

---

## GET `/JellyfinRecents/PosterSheet/{jobId}/image`

Retrieve the generated JPEG image. Only available when job status is `"done"`.

**Responses**:

`200 OK` — `Content-Type: image/jpeg`, binary body.

`404 Not Found` — job not found.

`409 Conflict` — job exists but is not yet `done`:
```json
{ "error": "Job not complete. Status: running" }
```

---

## DELETE `/JellyfinRecents/PosterSheet/{jobId}`

Cancel a running or queued job. No-op if already done/error/cancelled.

**Responses**:

`204 No Content` — cancelled (or was already terminal).

`404 Not Found` — job not found.

---

## POST `/JellyfinRecents/PosterSheet/preview`

Generate and return a small JPEG preview image reflecting the supplied overlay settings, using solid-colour placeholder cells in place of actual video frames. Invokes the Rust binary's `preview` subcommand synchronously (no ffmpeg call; completes in < 1 s). Intended to be called when the user clicks the **Preview** button in the settings panel.

**Request body** (`application/json`) — same `overlay` shape as the generation endpoint, plus font and theme fields:
```json
{
  "overlay": {
    "brandingEnabled": true,
    "brandingText": "Jellyfin Recents",
    "videoInfoEnabled": true,
    "showFileSize": true,
    "showResolutionFps": true,
    "showVideoEncoding": true,
    "showAudioEncoding": true,
    "showDuration": true,
    "showFrameTimestamp": false,
    "colorTheme": "dark",
    "fontFamily": "noto-serif"
  }
}
```

**Responses**:

`200 OK` — `Content-Type: image/jpeg`, small preview image (~400×270 px, 3×2 placeholder grid).

`400 Bad Request` — unknown theme name or invalid settings.

`503 Service Unavailable` — Rust binary not yet available (font acquisition still in progress).

---

## GET `/JellyfinRecents/PosterSheet/cache/{itemId}`

Check if a cached sheet exists for the given item and settings without starting a job.

**Query params** (all required):
| Param | Type |
|-------|------|
| `rows` | int |
| `cols` | int |
| `seed` | string |
| `overlayHash` | string (8-char) |

**Responses**:

`200 OK` — cache hit:
```json
{ "cached": true, "jobId": null }
```
*(frontend can immediately call `/image` via a synthetic job ID constructed from params)*

`204 No Content` — cache miss.

---

## Existing Endpoint Change

### GET `/JellyfinRecents/PlayHistory` — response extended

`PlayRecord` objects gain one additional field:

```json
{
  "itemId": "...",
  "title": "...",
  "videoDuration": 3003.0,
  ...
}
```

`videoDuration` is `null` for audio-only items. This allows the frontend to enforce short-video grid constraints (FR-002, FR-003) without an additional API call.
