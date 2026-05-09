import { useState } from 'preact/hooks'
import type { PlayRecord, ViewMode } from '../types'
import { getCurrentUserId } from '../api/jellyfinClient'

interface Props {
  record: PlayRecord
  showTypeLabel?: boolean
  viewMode?: ViewMode
}

async function apiToggleFavorite(itemId: string, nowFavorite: boolean): Promise<void> {
  const userId = getCurrentUserId()
  if (!window.ApiClient) throw new Error('ApiClient unavailable')
  const url = window.ApiClient.getUrl(`Users/${userId}/FavoriteItems/${itemId}`)
  await window.ApiClient.ajax({ url, type: nowFavorite ? 'POST' : 'DELETE' })
}

function formatPlayedDate(date: Date): string {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}年${m}月${d}日 ${h}:${min}`
}

export function PlayRecordCard({ record, showTypeLabel = false, viewMode = 'thumbnail' }: Props) {
  const [isFav, setIsFav] = useState(record.favoritedAt !== null)
  const [favLoading, setFavLoading] = useState(false)

  const imageUrl = record.imagePrimaryTag
    ? `/Items/${record.itemId}/Images/Primary?fillWidth=320&quality=90&tag=${record.imagePrimaryTag}`
    : `/Items/${record.itemId}/Images/Primary?fillWidth=320&quality=90`
  const detailUrl = `#!/details?id=${record.itemId}`

  async function handleFavClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (favLoading) return
    const next = !isFav
    setIsFav(next)
    setFavLoading(true)
    try {
      await apiToggleFavorite(record.itemId, next)
    } catch {
      setIsFav(!next) // rollback
    } finally {
      setFavLoading(false)
    }
  }

  if (viewMode === 'list') {
    return (
      <a class="jr-card jr-card--list" href={detailUrl}>
        <div class="jr-card__thumb jr-card__thumb--list">
          <img
            src={imageUrl}
            alt={record.title}
            loading="lazy"
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement
              img.style.display = 'none'
              img.nextElementSibling?.classList.remove('jr-card__thumb-placeholder--hidden')
            }}
          />
          <div class="jr-card__thumb-placeholder jr-card__thumb-placeholder--hidden">🎬</div>
        </div>
        <div class="jr-card__info jr-card__info--list">
          <div class="jr-card__title" title={record.title}>{record.title}</div>
          <div class="jr-card__meta">
            {showTypeLabel && (
              <span class={`jr-card__type-badge jr-card__type-badge--${record.mediaType}`}>
                {record.mediaType === 'video' ? '视频' : '音频'}
              </span>
            )}
            <span class="jr-card__played-date">{formatPlayedDate(record.playedDate)}</span>
            <button
              class={`jr-card__fav-btn${isFav ? ' jr-card__fav-btn--active' : ''}`}
              onClick={handleFavClick}
              title={isFav ? '取消收藏' : '收藏'}
            >♥</button>
          </div>
        </div>
      </a>
    )
  }

  return (
    <a class="jr-card" href={detailUrl}>
      <div class="jr-card__thumb">
        <img
          src={imageUrl}
          alt={record.title}
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement
            img.style.display = 'none'
            img.nextElementSibling?.classList.remove('jr-card__thumb-placeholder--hidden')
          }}
        />
        <div class="jr-card__thumb-placeholder jr-card__thumb-placeholder--hidden">🎬</div>
        {showTypeLabel && (
          <span class={`jr-card__type-badge jr-card__type-badge--${record.mediaType}`}>
            {record.mediaType === 'video' ? '视频' : '音频'}
          </span>
        )}
        <div class="jr-card__overlay">
          <div class="jr-card__play-btn">▶</div>
          <div class="jr-card__actions">
            <button
              class={`jr-card__fav-btn${isFav ? ' jr-card__fav-btn--active' : ''}`}
              onClick={handleFavClick}
              title={isFav ? '取消收藏' : '收藏'}
            >♥</button>
          </div>
        </div>
      </div>
      <div class="jr-card__info">
        <div class="jr-card__title" title={record.title}>{record.title}</div>
        <div class="jr-card__played-date">{formatPlayedDate(record.playedDate)}</div>
      </div>
    </a>
  )
}
