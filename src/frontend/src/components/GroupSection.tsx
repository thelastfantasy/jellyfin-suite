import type { TimeGroup, ViewMode } from '../types'
import { PlayRecordCard } from './PlayRecordCard'

interface Props {
  group: TimeGroup
  showTypeLabel?: boolean
  viewMode?: ViewMode
}

export function GroupSection({ group, showTypeLabel = false, viewMode = 'thumbnail' }: Props) {
  if (group.records.length === 0) return null

  return (
    <section class="jr-group">
      <h2 class="jr-group__title">{group.label}</h2>
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
    </section>
  )
}
