export interface OverlaySettingsDto {
  brandingEnabled: boolean
  brandingText: string
  videoInfoEnabled: boolean
  showFileSize: boolean
  showResolutionFps: boolean
  showVideoEncoding: boolean
  showAudioEncoding: boolean
  showDuration: boolean
  showSubtitles: boolean
  showFrameTimestamp: boolean
  colorTheme: string
  fontFamily: string
  brandingLatinFont: string
  brandingCjkFont: string
  lang: string
  timestampPosition: string
}

export interface SkipSegment {
  startMs: number
  endMs: number
}

export interface StartJobRequest {
  rows: number
  cols: number
  mode: 'deterministic' | 'random'
  seed?: string
  overlay: OverlaySettingsDto
  skipSegments?: SkipSegment[]
}

export function loadSkipSegments(): SkipSegment[] {
  try { return JSON.parse(localStorage.getItem('jfs-poster-skip-segments') ?? '[]') ?? [] }
  catch { return [] }
}

export function saveSkipSegments(segs: SkipSegment[]): void {
  localStorage.setItem('jfs-poster-skip-segments', JSON.stringify(segs))
}

export function loadGlobalSkipSegments(): SkipSegment[] {
  try { return JSON.parse(localStorage.getItem('jfs-poster-global-skip') ?? '[]') ?? [] }
  catch { return [] }
}

export function saveGlobalSkipSegments(segs: SkipSegment[]): void {
  localStorage.setItem('jfs-poster-global-skip', JSON.stringify(segs))
}

/** 合并两组区间，排序并消除重叠，过滤无效段（end <= start）。 */
export function mergeSegments(a: SkipSegment[], b: SkipSegment[]): SkipSegment[] {
  const all = [...a, ...b].filter(s => s.endMs > s.startMs)
  if (all.length === 0) return []
  all.sort((x, y) => x.startMs - y.startMs)
  const merged: SkipSegment[] = [{ ...all[0] }]
  for (let i = 1; i < all.length; i++) {
    const last = merged[merged.length - 1]
    if (all[i].startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, all[i].endMs)
    } else {
      merged.push({ ...all[i] })
    }
  }
  return merged
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
  subtitleCount: number | null
  duration: string
}

const BASE = '/JellyfinSuite/PosterSheet'

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
  const d: any = await res.json()
  return {
    jobId: d.jobId ?? d.JobId ?? '',
    itemId: d.itemId ?? d.ItemId ?? '',
    status: (d.status ?? d.Status ?? 'running') as JobStatusDto['status'],
    progress: d.progress ?? d.Progress ?? 0,
    total: d.total ?? d.Total ?? 0,
    error: d.error ?? d.Error ?? null,
    mediaInfo: d.mediaInfo ?? d.MediaInfo ?? null,
  }
}

export function getImageUrl(jobId: string): string {
  const token = window.ApiClient?.accessToken()
  return token ? `${BASE}/${jobId}/image?api_key=${encodeURIComponent(token)}` : `${BASE}/${jobId}/image`
}

export async function cancelJob(jobId: string): Promise<void> {
  await apiFetch(`${BASE}/${jobId}`, { method: 'DELETE' })
}

export interface JobListItemDto {
  jobId: string
  itemId: string
  itemTitle: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  total: number
  error: string | null
}

export async function listJobs(): Promise<JobListItemDto[]> {
  try {
    const res = await apiFetch(`${BASE}/jobs`)
    if (!res.ok) return []
    const raw: any[] = await res.json()
    return raw.map(d => ({
      jobId: d.jobId ?? d.JobId ?? '',
      itemId: d.itemId ?? d.ItemId ?? '',
      itemTitle: d.itemTitle ?? d.ItemTitle ?? '',
      status: (d.status ?? d.Status ?? 'done') as JobListItemDto['status'],
      progress: d.progress ?? d.Progress ?? 0,
      total: d.total ?? d.Total ?? 0,
      error: d.error ?? d.Error ?? null,
    }))
  } catch {
    return []
  }
}

export async function checkCache(
  itemId: string, rows: number, cols: number, seed: string, overlayHash: string
): Promise<boolean> {
  const params = new URLSearchParams({ rows: String(rows), cols: String(cols), seed, overlayHash })
  const res = await apiFetch(`${BASE}/cache/${itemId}?${params}`)
  if (res.status === 204) return false
  if (res.ok) { const d = await res.json(); return d.cached ?? d.Cached ?? false }
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

function migratePosterStorageOnce(): void {
  const pairs: [string, string][] = [
    ['jfs-poster-rows',          'jr-poster-rows'],
    ['jfs-poster-cols',          'jr-poster-cols'],
    ['jfs-poster-mode',          'jr-poster-mode'],
    ['jfs-poster-overlay',       'jr-poster-overlay'],
    ['jfs-poster-skip-segments', 'jr-poster-skip-segments'],
    ['jfs-poster-global-skip',   'jr-poster-global-skip'],
    ['jfs-poster-headless',      'jr-poster-headless'],
  ]
  try {
    for (const [nk, ok] of pairs) {
      if (localStorage.getItem(nk) === null) {
        const v = localStorage.getItem(ok)
        if (v !== null) { localStorage.setItem(nk, v); localStorage.removeItem(ok) }
      }
    }
  } catch { /* localStorage 不可用时静默失败 */ }
}
migratePosterStorageOnce()

function defaultOverlay(): OverlaySettingsDto {
  return {
    brandingEnabled: true,
    brandingText: 'Jellyfin Suite',
    videoInfoEnabled: true,
    showFileSize: true,
    showResolutionFps: true,
    showVideoEncoding: true,
    showAudioEncoding: true,
    showDuration: true,
    showSubtitles: true,
    showFrameTimestamp: false,
    colorTheme: 'classic',
    fontFamily: 'noto-sans-jp',
    brandingLatinFont: 'noto-sans',
    brandingCjkFont: 'noto-sans-jp',
    lang: 'en',
    timestampPosition: 'inside-bottom-left',
  }
}

export function loadStartJobRequest(): StartJobRequest {
  const rows = Math.max(1, Number(localStorage.getItem('jfs-poster-rows') ?? 6))
  const cols = Math.max(1, Number(localStorage.getItem('jfs-poster-cols') ?? 8))
  const mode = (localStorage.getItem('jfs-poster-mode') ?? 'deterministic') as 'deterministic' | 'random'
  const overlay: OverlaySettingsDto = (() => {
    try { return JSON.parse(localStorage.getItem('jfs-poster-overlay') ?? 'null') ?? defaultOverlay() }
    catch { return defaultOverlay() }
  })()
  return { rows, cols, mode, seed: mode === 'random' ? crypto.randomUUID() : undefined, overlay }
}

export type FontScript = 'latin' | 'cjk' | 'emoji' | 'symbol'

export interface UserFontInfo {
  key: string
  displayName: string
  script: FontScript
  format: string
  isSerif: boolean | null
  isMonospace: boolean | null
  isBold: boolean | null
  isItalic: boolean | null
  hasLigatures: boolean | null
}

function mapFontInfo(x: any): UserFontInfo | null {
  const key = typeof x === 'string' ? x : (x.key ?? x.Key ?? '')
  if (!key) return null
  const script = x.script ?? x.Script ?? 'latin'
  return {
    key,
    displayName: x.displayName ?? x.DisplayName ?? key,
    script: (['latin', 'cjk', 'emoji', 'symbol'].includes(script) ? script : 'latin') as FontScript,
    format: x.format ?? x.Format ?? 'ttf',
    isSerif: x.isSerif ?? x.IsSerif ?? null,
    isMonospace: x.isMonospace ?? x.IsMonospace ?? null,
    isBold: x.isBold ?? x.IsBold ?? null,
    isItalic: x.isItalic ?? x.IsItalic ?? null,
    hasLigatures: x.hasLigatures ?? x.HasLigatures ?? null,
  }
}

export async function listUserFonts(): Promise<UserFontInfo[]> {
  const res = await apiFetch(`${BASE}/fonts`)
  if (!res.ok) return []
  const raw: any[] = await res.json().catch(() => [])
  return raw.map(mapFontInfo).filter((x): x is UserFontInfo => x !== null)
}

export async function uploadFont(file: File): Promise<UserFontInfo> {
  const token = window.ApiClient?.accessToken()
  const headers: Record<string, string> = token
    ? { 'Authorization': `MediaBrowser Token="${token}"` }
    : {}
  const body = new FormData()
  body.append('file', file)
  const res = await fetch(`${BASE}/fonts`, {
    method: 'POST',
    headers,
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || res.statusText)
  }
  const d = await res.json()
  return mapFontInfo(d) ?? { key: '', displayName: '', script: 'latin', format: 'ttf',
    isSerif: null, isMonospace: null, isBold: null, isItalic: null, hasLigatures: null }
}

export async function deleteUserFont(key: string): Promise<void> {
  const res = await apiFetch(`${BASE}/fonts/${encodeURIComponent(key)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
}
