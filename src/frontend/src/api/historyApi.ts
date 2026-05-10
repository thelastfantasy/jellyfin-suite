import { getCurrentUserId } from './jellyfinClient'
import type { MediaFilter, PlayRecord, SortByMode, SortOrder } from '../types'

interface PlayHistoryEntry {
  ItemId: string
  PlayedDate: string
  Title?: string
  MediaType?: string
  FavoritedAt?: string | null
  ReleaseDate?: string | null
  AddedDate?: string | null
  SeriesName?: string | null
  SeasonNumber?: number | null
  EpisodeNumber?: number | null
  ImagePrimaryTag?: string | null
}

interface PlayHistoryResponse {
  Entries: PlayHistoryEntry[]
  TotalCount: number
}

export interface HistoryResult {
  records: PlayRecord[]
  totalCount: number
}

export interface HistoryQuery {
  page: number
  pageSize: number
  sortBy: SortByMode
  sortOrder: SortOrder
  mediaFilter: MediaFilter
  showRepeats: boolean
  groupDedup: boolean
}

export async function getHistoryPlayed(query: HistoryQuery): Promise<HistoryResult> {
  const userId = getCurrentUserId()
  if (!window.ApiClient) throw new Error('ApiClient unavailable')

  const params: Record<string, string> = {
    userId,
    page: String(query.page),
    pageSize: String(query.pageSize),
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    showRepeats: String(query.showRepeats),
  }
  if (query.mediaFilter !== 'all') params['mediaType'] = query.mediaFilter

  const url = window.ApiClient.getUrl('JellyfinRecents/PlayHistory', params)
  const data = (await window.ApiClient.ajax({ url, type: 'GET', dataType: 'json' })) as PlayHistoryResponse

  const records = data.Entries.map((entry): PlayRecord => ({
    itemId: entry.ItemId,
    title: entry.Title ?? '未知标题',
    playedDate: new Date(entry.PlayedDate),
    favoritedAt: entry.FavoritedAt ? new Date(entry.FavoritedAt) : null,
    releaseDate: entry.ReleaseDate ? new Date(entry.ReleaseDate) : null,
    addedDate: entry.AddedDate ? new Date(entry.AddedDate) : null,
    mediaType: entry.MediaType === 'audio' ? 'audio' : 'video',
    imagePrimaryTag: entry.ImagePrimaryTag ?? null,
    seriesName: entry.SeriesName ?? null,
    seasonNumber: entry.SeasonNumber ?? null,
    episodeNumber: entry.EpisodeNumber ?? null,
  }))

  return { records, totalCount: data.TotalCount }
}
