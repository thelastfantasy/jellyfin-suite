import { useState, useEffect } from 'preact/hooks'
import type { PlayRecord, ViewMode } from '../types'
import { getCurrentUserId } from '../api/jellyfinClient'
import { formatPlayedDate } from '../i18n'
import { useLocale } from '../i18n/context'
import { FolderViewPopover } from './FolderViewPopover'

interface Props {
  record: PlayRecord
  showTypeLabel?: boolean
  viewMode?: ViewMode
  enableFolderView?: boolean
}

// Jellyfin 10.10.x 用 webpack 5 打包，playbackManager 不再全局暴露。
// __webpack_require__ 和 playbackManager 都缓存到 window，跨 IIFE 重新执行时复用。
let _playbackManager: any = null

function getWebpackRequire(): any {
  const w = window as any
  if (w.__jr_wr) return w.__jr_wr
  const wc = w.webpackChunk as any[][]
  if (!wc) return null
  let wr: any = null
  const orig = wc.push.bind(wc)
  // 用时间戳保证 chunk ID 唯一，避免重复注册被忽略
  orig([[`jr-wr-${Date.now()}`], {}, (__webpack_require__: any) => { wr = __webpack_require__ }])
  if (!wr) return null
  w.__jr_wr = wr
  return wr
}

function getPlaybackManager(): any {
  if (_playbackManager) return _playbackManager
  const w = window as any
  if (w.__jr_pm) { _playbackManager = w.__jr_pm; return _playbackManager }
  const wr = getWebpackRequire()
  if (!wr) return null
  // 搜索所有已加载模块，找有 play/pause/isPlaying 的对象（playbackManager 特征）
  for (const id of Object.keys(wr.m)) {
    try {
      const mod = wr(id)
      if (!mod || typeof mod !== 'object') continue
      for (const exp of [mod, mod.default, ...Object.values(mod)]) {
        if (exp && typeof exp === 'object'
          && typeof (exp as any).play === 'function'
          && typeof (exp as any).pause === 'function'
          && typeof (exp as any).isPlaying === 'function') {
          _playbackManager = exp
          w.__jr_pm = exp
          return _playbackManager
        }
      }
    } catch { /* 跳过加载失败的模块 */ }
  }
  return null
}

function playItem(itemId: string, startPositionTicks = 0): void {
  const pm = getPlaybackManager()
  if (!pm) { console.error('[JellyfinRecents] playbackManager not found'); return }
  const apiClient = window.ApiClient
  if (!apiClient) return
  const userId = getCurrentUserId()
  apiClient.getItem(userId, itemId).then((item: any) => {
    pm.play({ items: [item], startPositionTicks, serverId: apiClient.serverId() })
  })
}

async function apiToggleFavorite(itemId: string, nowFavorite: boolean): Promise<void> {
  const userId = getCurrentUserId()
  if (!window.ApiClient) throw new Error('ApiClient unavailable')
  const url = window.ApiClient.getUrl(`Users/${userId}/FavoriteItems/${itemId}`)
  await window.ApiClient.ajax({ url, type: nowFavorite ? 'POST' : 'DELETE' })
}

export function PlayRecordCard({ record, showTypeLabel = false, viewMode = 'thumbnail', enableFolderView = false }: Props) {
  const { locale, t } = useLocale()
  const [isFav, setIsFav] = useState(record.favoritedAt !== null)
  const [favLoading, setFavLoading] = useState(false)
  const [canResume, setCanResume] = useState(false)
  const [resumeTicks, setResumeTicks] = useState(0)

  useEffect(() => {
    if (!window.ApiClient) return
    const userId = getCurrentUserId()
    const url = window.ApiClient.getUrl(`Users/${userId}/Items/${record.itemId}`)
    window.ApiClient.ajax({ url, type: 'GET', dataType: 'json' }).then((item: any) => {
      const ud = item?.UserData
      if (ud && ud.PlaybackPositionTicks > 0 && !ud.Played) {
        setCanResume(true)
        setResumeTicks(ud.PlaybackPositionTicks)
      }
    }).catch(() => { /* ignore */ })
  }, [record.itemId])

  useEffect(() => {
    function handler(e: CustomEvent<{ itemId: string; favoritedAt: string | null }>) {
      if (e.detail.itemId === record.itemId) {
        setIsFav(e.detail.favoritedAt !== null)
      }
    }
    window.addEventListener('jr-fav-change', handler as EventListener)
    return () => window.removeEventListener('jr-fav-change', handler as EventListener)
  }, [record.itemId])

  const imageUrl = record.imagePrimaryTag
    ? `/Items/${record.itemId}/Images/Primary?fillWidth=320&quality=90&tag=${record.imagePrimaryTag}`
    : `/Items/${record.itemId}/Images/Primary?fillWidth=320&quality=90`
  const detailUrl = `#!/details?id=${record.itemId}`
  const seriesUrl = record.seriesId ? `#!/details?id=${record.seriesId}` : null

  function handlePlayClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    playItem(record.itemId)
  }

  function handleResumeClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    playItem(record.itemId, resumeTicks)
  }

  async function handleFavClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (favLoading) return
    const next = !isFav
    const now = next ? new Date().toISOString() : null
    setIsFav(next)
    setFavLoading(true)
    try {
      await apiToggleFavorite(record.itemId, next)
      window.dispatchEvent(new CustomEvent('jr-fav-change', { detail: { itemId: record.itemId, favoritedAt: now } }))
    } catch {
      setIsFav(!next)
      window.dispatchEvent(new CustomEvent('jr-fav-change', { detail: { itemId: record.itemId, favoritedAt: record.favoritedAt?.toISOString() ?? null } }))
    } finally {
      setFavLoading(false)
    }
  }

  const episodeCode = record.episodeNumber != null
    ? record.seasonNumber === 0
      ? `SP${record.episodeNumber}`
      : `S${record.seasonNumber ?? 1}E${record.episodeNumber}`
    : null

  if (viewMode === 'list') {
    return (
      <div class="jr-card jr-card--list" data-jr-id={`${record.itemId}-${record.playedDate.getTime()}`}>
        <a class="jr-card__thumb jr-card__thumb--list" href={detailUrl}>
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
        </a>
        <div class="jr-card__info jr-card__info--list">
          <div class="jr-card__title-block">
            {record.seriesName && (
              seriesUrl
                ? <a class="jr-card__series-name" href={seriesUrl}>{record.seriesName}</a>
                : <div class="jr-card__series-name">{record.seriesName}</div>
            )}
            <a class="jr-card__title" href={detailUrl} title={record.title}>
              {episodeCode && <span class="jr-card__ep-code">{episodeCode}</span>}
              {record.title}
            </a>
          </div>
          <div class="jr-card__meta">
            {showTypeLabel && (
              <span class={`jr-card__type-badge jr-card__type-badge--${record.mediaType}`}>
                {record.mediaType === 'video' ? t.video : t.audio}
              </span>
            )}
            <span class="jr-card__played-date">{formatPlayedDate(record.playedDate, locale)}</span>
            <button
              class={`jr-card__fav-btn${isFav ? ' jr-card__fav-btn--active' : ''}`}
              onClick={handleFavClick}
              title={isFav ? t.unfavorite : t.favorite}
            >
              <span class="material-icons">{isFav ? 'favorite' : 'favorite_border'}</span>
            </button>
            {enableFolderView && record.hasAncestors && (
              <FolderViewPopover itemId={record.itemId} viewMode="list" />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="jr-card" data-jr-id={`${record.itemId}-${record.playedDate.getTime()}`}>
      <div class="jr-card__thumb-link-wrap">
        <a class="jr-card__thumb-link" href={detailUrl}>
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
            {episodeCode && (
              <div class="jr-card__ep-badge">{episodeCode}</div>
            )}
            {showTypeLabel && (
              <span class={`jr-card__type-badge jr-card__type-badge--${record.mediaType}`}>
                {record.mediaType === 'video' ? t.video : t.audio}
              </span>
            )}
            <div class="jr-card__overlay">
              {canResume ? (
                <div class="jr-card__overlay-center">
                  <button class="jr-card__resume-btn" onClick={handleResumeClick} title={t.resume}>
                    <span class="material-icons">play_arrow</span>
                  </button>
                  <button class="jr-card__play-btn jr-card__play-btn--small" onClick={handlePlayClick} title={t.play}>
                    <span class="material-icons">replay</span>
                  </button>
                </div>
              ) : (
                <button class="jr-card__play-btn" onClick={handlePlayClick} title={t.play}>
                  <span class="material-icons">play_arrow</span>
                </button>
              )}
            </div>
            {isFav && (
              <div class="jr-card__actions jr-card__actions--sticky">
                <button
                  class="jr-card__fav-btn jr-card__fav-btn--active"
                  onClick={handleFavClick}
                  title={t.unfavorite}
                >
                  <span class="material-icons">favorite</span>
                </button>
              </div>
            )}
            <div class="jr-card__overlay jr-card__overlay--actions">
              <div class="jr-card__actions">
                <button
                  class={`jr-card__fav-btn${isFav ? ' jr-card__fav-btn--active' : ''}`}
                  onClick={handleFavClick}
                  title={isFav ? t.unfavorite : t.favorite}
                >
                  <span class="material-icons">{isFav ? 'favorite' : 'favorite_border'}</span>
                </button>
              </div>
            </div>
          </div>
        </a>
        {enableFolderView && record.hasAncestors && (
          <FolderViewPopover itemId={record.itemId} showTypeLabel={showTypeLabel} />
        )}
      </div>
      <div class="jr-card__info">
        {record.seriesName && (
          seriesUrl
            ? <a class="jr-card__series-name" href={seriesUrl}>{record.seriesName}</a>
            : <div class="jr-card__series-name">{record.seriesName}</div>
        )}
        <a class="jr-card__title" href={detailUrl} title={record.title}>{record.title}</a>
        <div class="jr-card__played-date">{formatPlayedDate(record.playedDate, locale)}</div>
      </div>
    </div>
  )
}
