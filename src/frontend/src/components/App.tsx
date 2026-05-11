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

// 注入 scrollbar-gutter: stable 到 html
if (typeof document !== 'undefined' && !document.getElementById('jr-scrollbar-gutter')) {
  const s = document.createElement('style')
  s.id = 'jr-scrollbar-gutter'
  s.textContent = 'html { scrollbar-gutter: stable; }'
  document.head.appendChild(s)
}

interface Props {
  locale: Locale
}

function getTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function App({ locale }: Props) {
  const t = getTranslations(locale)

  const [settings, setSettings] = useState<ViewSettings>(loadSettings)
  const [pageIndex, setPageIndex] = useState(0)
  const [groups, setGroups] = useState<TimeGroup[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchData(s: ViewSettings, page: number) {
    setLoading(true)
    setError(null)
    try {
      const { records, totalCount: count, totalPages: pages } = await getHistoryPlayed({
        groupBy: s.groupBy,
        page,
        tz: getTimezone(),
        sortBy: s.sortBy,
        sortOrder: s.sortOrder,
        mediaFilter: s.mediaFilter,
        showRepeats: s.showRepeats,
        groupDedup: s.groupDedup,
      })

      const grouped = groupByMode(records, s.groupBy, locale, t, s.groupDedup).map((g) => ({
        ...g,
        records: sortRecords(g.records, s.sortBy, s.sortOrder),
      }))

      setGroups(grouped)
      setTotalCount(count)
      setTotalPages(Math.max(1, pages))
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

        {!loading && !error && groups.map((group, i) => (
          <GroupSection
            key={group.label}
            group={group}
            showTypeLabel={settings.mediaFilter === 'all'}
            viewMode={settings.viewMode}
            groupIndex={i}
            totalGroups={groups.length}
            hasPrevPage={pageIndex > 0}
            hasNextPage={pageIndex < totalPages - 1}
            onPageNav={(dir) => handlePageChange(dir === 'next' ? pageIndex + 1 : pageIndex - 1)}
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
