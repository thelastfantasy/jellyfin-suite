export interface Translations {
  // App title (sidebar / page header)
  appTitle: string
  // Toolbar labels
  groupLabel: string
  sortLabel: string
  typeLabel: string
  viewLabel: string
  // Group by options
  groupDay: string
  groupWeek: string
  groupMonth: string
  groupQuarter: string
  groupYear: string
  // Sort by options
  sortPlayedDate: string
  sortTitle: string
  sortFavoritedAt: string
  sortReleaseDate: string
  sortAddedDate: string
  // Media filter options
  filterVideo: string
  filterAudio: string
  filterAll: string
  // Sort order button tooltips
  sortDesc: string
  sortAsc: string
  // Checkbox
  showRepeats: string
  groupDedup: string
  // View mode button tooltips
  viewThumbnail: string
  viewPoster: string
  viewList: string
  // Status messages
  loading: string
  empty: string
  retry: string
  loadError: string
  // Card actions
  play: string
  favorite: string
  unfavorite: string
  // Media type badge
  video: string
  audio: string
  // Quarter season names: [winter, spring, summer, autumn]
  quarterNames: [string, string, string, string]
  // Folder view
  folderViewTitle: string
  folderViewEmpty: string
}
