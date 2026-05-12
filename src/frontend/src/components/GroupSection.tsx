import { Fragment } from 'preact'
import { RiArrowDropUpFill, RiArrowDropDownFill } from 'react-icons/ri'
import type { TimeGroup, ViewMode } from '../types'
import { PlayRecordCard } from './PlayRecordCard'

interface Props {
  group: TimeGroup
  showTypeLabel?: boolean
  viewMode?: ViewMode
  enableFolderView?: boolean
  groupIndex: number
  totalGroups: number
  hasPrevPage: boolean
  hasNextPage: boolean
  onPageNav: (direction: 'prev' | 'next') => void
}

function scrollToGroupHeader(index: number) {
  const cards = document.querySelectorAll<HTMLElement>('.jr-group__cards')
  const el = cards[index]
  if (!el) return
  const title = el.previousElementSibling as HTMLElement | null
  const titleH = title?.offsetHeight ?? 50
  window.scrollTo({ top: el.offsetTop - titleH - 56, behavior: 'smooth' })
  if (title) {
    title.classList.remove('jr-group__title--highlight')
    void title.offsetWidth // reflow 以便重复触发动画
    title.classList.add('jr-group__title--highlight')
    title.addEventListener('animationend', () => title.classList.remove('jr-group__title--highlight'), { once: true })
  }
}

export function GroupSection({
  group, showTypeLabel = false, viewMode = 'thumbnail',
  enableFolderView = false,
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
            <RiArrowDropUpFill />
          </button>
          <button
            class="jr-group__nav-btn"
            onClick={handleDown}
            disabled={!canDown}
            title="Next group"
          >
            <RiArrowDropDownFill />
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
            enableFolderView={enableFolderView}
          />
        ))}
      </div>
    </Fragment>
  )
}
