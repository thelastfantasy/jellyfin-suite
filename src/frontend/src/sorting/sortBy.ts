import type { PlayRecord, SortByMode, SortOrder } from '../types'

export function sortRecords(
  records: PlayRecord[],
  sortBy: SortByMode,
  sortOrder: SortOrder,
): PlayRecord[] {
  const sorted = [...records].sort((a, b) => {
    let result = 0

    switch (sortBy) {
      case 'title':
        result = a.title.localeCompare(b.title, 'zh-CN')
        break
      case 'playedDate':
        result = a.playedDate.getTime() - b.playedDate.getTime()
        break
      case 'favorite':
        // 收藏优先：isFavorite desc 为主，playedDate desc 为次级
        if (a.isFavorite !== b.isFavorite) {
          result = a.isFavorite ? -1 : 1
        } else {
          result = b.playedDate.getTime() - a.playedDate.getTime()
        }
        return result // favorite 模式固定收藏在前，不再翻转
      case 'releaseYear':
        // null 排末尾
        if (a.releaseYear === null && b.releaseYear === null) result = 0
        else if (a.releaseYear === null) result = 1
        else if (b.releaseYear === null) result = -1
        else result = a.releaseYear - b.releaseYear
        break
      case 'addedDate':
        // null 排末尾
        if (!a.addedDate && !b.addedDate) result = 0
        else if (!a.addedDate) result = 1
        else if (!b.addedDate) result = -1
        else result = a.addedDate.getTime() - b.addedDate.getTime()
        break
    }

    return sortOrder === 'desc' ? -result : result
  })

  return sorted
}
