import { useEffect, useState } from 'preact/hooks'
import type { TimeGroup, ViewSettings } from '../types'
import type { Locale } from '../i18n'
import { getTranslations } from '../i18n'
import { LocaleContext } from '../i18n/context'
import { getHistoryPlayed } from '../api/historyApi'
import { groupByMode } from '../grouping/groupBy'
import { sortRecords } from '../sorting/sortBy'
import { loadSettings, saveSettings } from '../state/viewSettings'
import { Toolbar } from './Toolbar'
import { GroupSection } from './GroupSection'
import { Pagination } from './Pagination'

const PAGE_SIZE = 100

// 注入 scrollbar-gutter: stable 到 html，防止 Jellyfin 菜单弹出时移除滚动条导致内容位移
if (typeof document !== 'undefined' && !document.getElementById('jr-scrollbar-gutter')) {
  const s = document.createElement('style')
  s.id = 'jr-scrollbar-gutter'
  s.textContent = 'html { scrollbar-gutter: stable; }'
  document.head.appendChild(s)
}

interface Props {
  locale: Locale
}

export function App({ locale }: Props) {
  const t = getTranslations(locale)

  const [settings, setSettings] = useState<ViewSettings>(loadSettings)
  const [pageIndex, setPageIndex] = useState(0)
  const [groups, setGroups] = useState<TimeGroup[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1

  async function fetchData(s: ViewSettings, page: number) {
    setLoading(true)
    setError(null)
    try {
      const { records, totalCount: count } = await getHistoryPlayed({
        page,
        pageSize: PAGE_SIZE,
        sortBy: s.sortBy,
        sortOrder: s.sortOrder,
        mediaFilter: s.mediaFilter,
        showRepeats: s.showRepeats,
      })

      const grouped = groupByMode(records, s.groupBy, locale, t).map((g) => ({
        ...g,
        records: sortRecords(g.records, s.sortBy, s.sortOrder),
      }))

      setGroups(grouped)
      setTotalCount(count)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadError)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData(settings, pageIndex)
  }, [settings, pageIndex])

  function handleSettingsChange(patch: Partial<ViewSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
    setPageIndex(0)
  }

  function handlePageChange(index: number) {
    setPageIndex(index)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <LocaleContext.Provider value={{ locale, t }}>
      <div class="jr-app">
        <Toolbar settings={settings} onSettingsChange={handleSettingsChange} />

        {loading && (
          <div class="jr-status jr-status--loading">
            <span class="jr-spinner" />
            {t.loading}
          </div>
        )}

        {error && !loading && (
          <div class="jr-status jr-status--error">
            <p>⚠️ {error}</p>
            <button class="jr-btn" onClick={() => fetchData(settings, pageIndex)}>{t.retry}</button>
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <div class="jr-status jr-status--empty">
            <p>{t.empty}</p>
          </div>
        )}

        {!loading && !error && groups.map((group) => (
          <GroupSection
            key={group.label}
            group={group}
            showTypeLabel={settings.mediaFilter === 'all'}
            viewMode={settings.viewMode}
          />
        ))}

        {totalCount > 0 && (
          <Pagination
            pageIndex={pageIndex}
            totalPages={totalPages}
            totalCount={totalCount}
            onPageChange={handlePageChange}
          />
        )}
      </div>
    </LocaleContext.Provider>
  )
}
