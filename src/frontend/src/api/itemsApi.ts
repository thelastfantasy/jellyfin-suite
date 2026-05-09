import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api'
import {
  BaseItemKind,
  ItemFields,
  ItemFilter,
  ItemSortBy,
  SortOrder,
} from '@jellyfin/sdk/lib/generated-client'
import { getApi, getCurrentUserId } from './jellyfinClient'
import type { MediaFilter, PlayRecord } from '../types'

const VIDEO_TYPES: BaseItemKind[] = [BaseItemKind.Movie, BaseItemKind.Episode, BaseItemKind.Video]
const AUDIO_TYPES: BaseItemKind[] = [BaseItemKind.Audio, BaseItemKind.MusicAlbum, BaseItemKind.MusicArtist]

function getIncludeItemTypes(mediaFilter: MediaFilter): BaseItemKind[] | undefined {
  if (mediaFilter === 'video') return VIDEO_TYPES
  if (mediaFilter === 'audio') return AUDIO_TYPES
  return undefined
}

export async function getRecentlyPlayed(
  mediaFilter: MediaFilter = 'video',
  _startDate?: Date,
  _endDate?: Date,
): Promise<PlayRecord[]> {
  const api = getApi()
  const userId = getCurrentUserId()
  const itemsApi = getItemsApi(api)

  const response = await itemsApi.getItems({
    userId,
    filters: [ItemFilter.IsPlayed],
    sortBy: [ItemSortBy.DatePlayed],
    sortOrder: [SortOrder.Descending],
    recursive: true,
    fields: [ItemFields.DateCreated],
    includeItemTypes: getIncludeItemTypes(mediaFilter),
    limit: 1000,
  })

  return (response.data.Items ?? []).map((item): PlayRecord => ({
    itemId: item.Id ?? '',
    title: item.Name ?? '未知标题',
    playedDate: new Date(item.UserData?.LastPlayedDate ?? item.DateCreated ?? Date.now()),
    isFavorite: item.UserData?.IsFavorite ?? false,
    releaseYear: item.ProductionYear ?? null,
    addedDate: item.DateCreated ? new Date(item.DateCreated) : null,
    mediaType: (item.MediaType?.toLowerCase() === 'audio') ? 'audio' : 'video',
    imagePrimaryTag: item.ImageTags?.Primary ?? null,
  }))
}
