import { Fragment } from 'preact'
import type { TimeGroup, ViewMode } from '../types'
import { PlayRecordCard } from './PlayRecordCard'

interface Props {
  group: TimeGroup
  showTypeLabel?: boolean
  viewMode?: ViewMode
  groupIndex: number
  totalGroups: number
  hasPrevPage: boolean
  hasNextPage: boolean
  onPageNav: (direction: 'prev' | 'next') => void
}

function scrollToGroupHeader(index: number) {
  const headers = document.querySelectorAll<HTMLElement>('.jr-group__title')
  const el = headers[index]
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - 56
  window.scrollTo({ top, behavior: 'smooth' })
}

export function GroupSection({
  group, showTypeLabel = false, viewMode = 'thumbnail',
  groupIndex, totalGroups, hasPrevPage, hasNextPage, onPageNav,
}: Props) {
  if (group.records.length === 0) return null

  const isFirst = groupIndex === 0
  const isLast = groupIndex === totalGroups - 1
  const canUp = !isFirst || hasPrevPage
  const canDown = !isLast || hasNextPage

  function handleUp() {
    if (!isFirst) scrollToGroupHeader(groupIndex - 1)
    else if (hasPrevPage) onPageNav('prev')
  }

  function handleDown() {
    if (!isLast) scrollToGroupHeader(groupIndex + 1)
    else if (hasNextPage) onPageNav('next')
  }

  return (
    <Fragment>
      <h2 class="jr-group__title">
        <span class="jr-group__title-text">{group.label}</span>
        <span class="jr-group__nav">
          <button
            class="jr-group__nav-btn"
            onClick={handleUp}
            disabled={!canUp}
            title="Previous group"
          >
            <span class="material-icons">keyboard_arrow_up</span>
          </button>
          <button
            class="jr-group__nav-btn"
            onClick={handleDown}
            disabled={!canDown}
            title="Next group"
          >
            <span class="material-icons">keyboard_arrow_down</span>
          </button>
        </span>
      </h2>
      <div class={`jr-group__cards jr-group__cards--${viewMode}`}>
        {group.records.map((record) => (
          <PlayRecordCard
            key={`${record.itemId}-${record.playedDate.getTime()}`}
            record={record}
            showTypeLabel={showTypeLabel}
            viewMode={viewMode}
          />
        ))}
      </div>
    </Fragment>
  )
}
