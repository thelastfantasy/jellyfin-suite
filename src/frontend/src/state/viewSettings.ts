import type { ViewSettings } from '../types'

const STORAGE_KEY = 'jellyfin-recents-settings'

const DEFAULT_SETTINGS: ViewSettings = {
  groupBy: 'week',
  sortBy: 'playedDate',
  sortOrder: 'desc',
  mediaFilter: 'video',
  showRepeats: false,
  viewMode: 'thumbnail',
}

export function loadSettings(): ViewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: ViewSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage 不可用时静默失败
  }
}
