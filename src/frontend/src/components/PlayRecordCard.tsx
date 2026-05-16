import { useState, useEffect, useRef } from 'preact/hooks'
import { MdPlayArrow, MdReplay, MdFavorite, MdFavoriteBorder, MdGridView, MdKeyboardArrowDown } from 'react-icons/md'
import type { PlayRecord, ViewMode } from '../types'
import { getCurrentUserId } from '../api/jellyfinClient'
import { formatPlayedDate } from '../i18n'
import { useLocale } from '../i18n/context'
import { FolderViewPopover } from './FolderViewPopover'
import { startJob, loadStartJobRequest, loadGlobalSkipSegments, mergeSegments } from '../api/posterSheetApi'
import type { SkipSegment } from '../api/posterSheetApi'
import { addJob, getJobs } from '../state/posterJobStore'
import { flyToQueue } from '../utils/flyToQueue'
import { SkipSegmentsModal } from './SkipSegmentsModal'

interface Props {
  record: PlayRecord
  showTypeLabel?: boolean
  viewMode?: ViewMode
  enableFolderView?: boolean
  posterUnlocked?: boolean
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

export function PlayRecordCard({ record, showTypeLabel = false, viewMode = 'thumbnail', enableFolderView = false, posterUnlocked = false }: Props) {
  const { locale, t } = useLocale()
  const [isFav, setIsFav] = useState(record.favoritedAt !== null)
  const [favLoading, setFavLoading] = useState(false)
  const canResume = record.playbackPositionTicks != null && record.playbackPositionTicks > 0
  const resumeTicks = record.playbackPositionTicks ?? 0
  const [skipOpen, setSkipOpen] = useState(false)
  const thumbRef = useRef<HTMLDivElement>(null)

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

  function handlePosterClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (thumbRef.current) flyToQueue(thumbRef.current)
    const title = record.seriesName ? `${record.seriesName} — ${record.title}` : record.title
    const req = loadStartJobRequest()
    const globalSkips = loadGlobalSkipSegments().filter(s => s.endMs > s.startMs)
    if (globalSkips.length > 0) req.skipSegments = globalSkips
    startJob(record.itemId, req).then(id => {
      if (!getJobs().find(j => j.jobId === id)) addJob(id, record.itemId, title)
    }).catch(() => {})
  }

  function handleSkipClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setSkipOpen(true)
  }

  function handleSkipAndGenerate(segments: SkipSegment[], ignoreGlobal: boolean) {
    if (thumbRef.current) flyToQueue(thumbRef.current)
    const title = record.seriesName ? `${record.seriesName} — ${record.title}` : record.title
    const req = loadStartJobRequest()
    const globalSkips = ignoreGlobal ? [] : loadGlobalSkipSegments()
    const merged = mergeSegments(globalSkips, segments)
    if (merged.length > 0) req.skipSegments = merged
    startJob(record.itemId, req).then(id => {
      if (!getJobs().find(j => j.jobId === id)) addJob(id, record.itemId, title)
    }).catch(() => {})
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
            {canResume && (
              <>
                <button class="jr-card__resume-btn jr-card__resume-btn--sm" onClick={handleResumeClick} title={t.resume}>
                  <MdPlayArrow size={16} />
                </button>
                <button class="jr-card__fromstart-btn" onClick={handlePlayClick} title={t.play}>
                  <MdReplay size={18} />
                </button>
              </>
            )}
            <button
              class={`jr-card__fav-btn${isFav ? ' jr-card__fav-btn--active' : ''}`}
              onClick={handleFavClick}
              title={isFav ? t.unfavorite : t.favorite}
            >
              {isFav ? <MdFavorite size={22} /> : <MdFavoriteBorder size={22} />}
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
          <div class="jr-card__thumb" ref={thumbRef}>
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
                    <MdPlayArrow size={28} />
                  </button>
                  <button class="jr-card__play-btn jr-card__play-btn--small" onClick={handlePlayClick} title={t.play}>
                    <MdReplay size={15} />
                  </button>
                </div>
              ) : (
                <button class="jr-card__play-btn" onClick={handlePlayClick} title={t.play}>
                  <MdPlayArrow size={28} />
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
                  <MdFavorite size={22} />
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
                  {isFav ? <MdFavorite size={22} /> : <MdFavoriteBorder size={22} />}
                </button>
              </div>
            </div>
          </div>
        </a>
        {enableFolderView && record.hasAncestors && (
          <FolderViewPopover itemId={record.itemId} showTypeLabel={showTypeLabel} />
        )}
        {posterUnlocked && record.videoDuration !== null && (
          <button
            class={`jr-card__poster-btn${enableFolderView && record.hasAncestors ? ' jr-card__poster-btn--offset' : ''}`}
            title={t.posterGenerate2}
            onClick={handlePosterClick}
          >
            <MdGridView size={16} />
          </button>
        )}
        {posterUnlocked && record.videoDuration !== null && (
          <button
            class={`jr-card__poster-skip-btn${enableFolderView && record.hasAncestors ? ' jr-card__poster-skip-btn--offset' : ''}`}
            title="跳过片段生成截图墙"
            onClick={handleSkipClick}
          >
            <MdKeyboardArrowDown size={14} />
            <span class="jr-card__poster-skip-label">跳过片段</span>
          </button>
        )}
        {skipOpen && (
          <SkipSegmentsModal
            onClose={() => setSkipOpen(false)}
            onConfirm={handleSkipAndGenerate}
            itemId={record.itemId}
            videoDurationMs={record.videoDuration !== null ? Math.round(record.videoDuration * 1000) : undefined}
          />
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
