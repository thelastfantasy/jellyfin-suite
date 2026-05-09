import type { TimeGroup } from '../types'
import { PlayRecordCard } from './PlayRecordCard'

interface Props {
  group: TimeGroup
  showTypeLabel?: boolean
}

export function GroupSection({ group, showTypeLabel = false }: Props) {
  if (group.records.length === 0) return null

  return (
    <section class="jr-group">
      <h2 class="jr-group__title">{group.label}</h2>
      <div class="jr-group__cards">
        {group.records.map((record) => (
          <PlayRecordCard
            key={`${record.itemId}-${record.playedDate.getTime()}`}
            record={record}
            showTypeLabel={showTypeLabel}
          />
        ))}
      </div>
    </section>
  )
}
