export interface OverlaySettingsDto {
  brandingEnabled: boolean
  brandingText: string
  videoInfoEnabled: boolean
  showFileSize: boolean
  showResolutionFps: boolean
  showVideoEncoding: boolean
  showAudioEncoding: boolean
  showDuration: boolean
  showFrameTimestamp: boolean
  colorTheme: string
  fontFamily: string
  lang: string
}

export interface StartJobRequest {
  rows: number
  cols: number
  mode: 'deterministic' | 'random'
  seed?: string
  overlay: OverlaySettingsDto
}

export interface JobStatusDto {
  jobId: string
  itemId: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  total: number
  error: string | null
  mediaInfo: MediaInfoDto | null
}

export interface MediaInfoDto {
  filename: string
  fileSize: string
  fileSizeBytes: number
  resolution: string
  fps: number
  videoCodec: string
  bitDepth: number | null
  hdrType: string | null
  colourSpace: string | null
  audioCodec: string | null
  audioFormat: string | null
  audioBitrate: string | null
  audioTracks: number
  duration: string
}

const BASE = '/JellyfinRecents/PosterSheet'

function authHeaders(): Record<string, string> {
  const token = window.ApiClient?.accessToken()
  return token
    ? { 'Authorization': `MediaBrowser Token="${token}"`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } })
}

export async function startJob(itemId: string, req: StartJobRequest): Promise<string> {
  const res = await apiFetch(`${BASE}/${itemId}`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? res.statusText)
  }
  const data = await res.json()
  return data.jobId ?? data.JobId
}

export async function pollStatus(jobId: string): Promise<JobStatusDto> {
  const res = await apiFetch(`${BASE}/${jobId}/status`)
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`)
  return res.json()
}

export function getImageUrl(jobId: string): string {
  const token = window.ApiClient?.accessToken()
  return token ? `${BASE}/${jobId}/image?api_key=${encodeURIComponent(token)}` : `${BASE}/${jobId}/image`
}

export async function cancelJob(jobId: string): Promise<void> {
  await apiFetch(`${BASE}/${jobId}`, { method: 'DELETE' })
}

export async function checkCache(
  itemId: string, rows: number, cols: number, seed: string, overlayHash: string
): Promise<boolean> {
  const params = new URLSearchParams({ rows: String(rows), cols: String(cols), seed, overlayHash })
  const res = await apiFetch(`${BASE}/cache/${itemId}?${params}`)
  if (res.status === 204) return false
  if (res.ok) { const d = await res.json(); return d.cached }
  return false
}

export async function fetchPreview(overlay: OverlaySettingsDto, rows: number, cols: number): Promise<Blob> {
  const res = await apiFetch(`${BASE}/preview`, {
    method: 'POST',
    body: JSON.stringify({ overlay, rows, cols }),
  })
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`)
  return res.blob()
}

function defaultOverlay(): OverlaySettingsDto {
  return {
    brandingEnabled: true,
    brandingText: 'Jellyfin Recents',
    videoInfoEnabled: true,
    showFileSize: true,
    showResolutionFps: true,
    showVideoEncoding: true,
    showAudioEncoding: true,
    showDuration: true,
    showFrameTimestamp: false,
    colorTheme: 'classic',
    fontFamily: 'noto-sans',
    lang: 'en',
  }
}

export function loadStartJobRequest(): StartJobRequest {
  const rows = Math.max(1, Number(localStorage.getItem('jr-poster-rows') ?? 6))
  const cols = Math.max(1, Number(localStorage.getItem('jr-poster-cols') ?? 8))
  const mode = (localStorage.getItem('jr-poster-mode') ?? 'deterministic') as 'deterministic' | 'random'
  const overlay: OverlaySettingsDto = (() => {
    try { return JSON.parse(localStorage.getItem('jr-poster-overlay') ?? 'null') ?? defaultOverlay() }
    catch { return defaultOverlay() }
  })()
  return { rows, cols, mode, seed: mode === 'random' ? crypto.randomUUID() : undefined, overlay }
}
