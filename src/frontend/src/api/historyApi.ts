import { getCurrentUserId } from './jellyfinClient'
import type { GroupByMode, MediaFilter, PlayRecord, SortByMode, SortOrder } from '../types'

interface PlayHistoryEntry {
  ItemId: string
  PlayedDate: string
  Title?: string
  MediaType?: string
  FavoritedAt?: string | null
  ReleaseDate?: string | null
  AddedDate?: string | null
  SeriesName?: string | null
  SeriesId?: string | null
  SeasonNumber?: number | null
  EpisodeNumber?: number | null
  ImagePrimaryTag?: string | null
  HasAncestors?: boolean
  PlaybackPositionTicks?: number | null
  VideoDuration?: number | null
}

interface PlayHistoryResponse {
  Entries: PlayHistoryEntry[]
  TotalCount: number
  TotalPages: number
}

export interface HistoryResult {
  records: PlayRecord[]
  totalCount: number
  totalPages: number
}

export interface HistoryQuery {
  groupBy: GroupByMode
  page: number
  tz: string
  sortBy: SortByMode
  sortOrder: SortOrder
  mediaFilter: MediaFilter
  showRepeats: boolean
  groupDedup: boolean
  pageSize: number
}

export async function getHistoryPlayed(query: HistoryQuery): Promise<HistoryResult> {
  const userId = getCurrentUserId()
  if (!window.ApiClient) throw new Error('ApiClient unavailable')

  const params: Record<string, string> = {
    userId,
    groupBy: query.groupBy,
    page: String(query.page),
    tz: query.tz,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    showRepeats: String(query.showRepeats),
  }
  if (query.mediaFilter !== 'all') params['mediaType'] = query.mediaFilter
  if (query.groupDedup) params['groupDedup'] = 'true'
  params['pageSize'] = String(query.pageSize)

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
    seriesId: entry.SeriesId ?? null,
    seasonNumber: entry.SeasonNumber ?? null,
    episodeNumber: entry.EpisodeNumber ?? null,
    parentId: null,
    hasAncestors: entry.HasAncestors ?? false,
    playbackPositionTicks: entry.PlaybackPositionTicks ?? null,
    videoDuration: entry.VideoDuration ?? null,
  }))

  return { records, totalCount: data.TotalCount, totalPages: data.TotalPages }
}
