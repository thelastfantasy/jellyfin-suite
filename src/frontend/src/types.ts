export type GroupByMode = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type SortByMode = 'playedDate' | 'title' | 'favorite' | 'releaseYear' | 'addedDate'
export type SortOrder = 'asc' | 'desc'
export type MediaFilter = 'video' | 'audio' | 'all'

export interface PlayRecord {
  itemId: string
  title: string
  playedDate: Date
  isFavorite: boolean
  releaseYear: number | null
  addedDate: Date | null
  mediaType: 'video' | 'audio'
  imagePrimaryTag: string | null
}

export interface TimeGroup {
  label: string
  startDate: Date
  endDate: Date
  records: PlayRecord[]
}

export interface GroupedPage {
  groups: TimeGroup[]
  pageIndex: number
  totalPages: number
}

export interface ViewSettings {
  groupBy: GroupByMode
  sortBy: SortByMode
  sortOrder: SortOrder
  mediaFilter: MediaFilter
  showRepeats: boolean
}
