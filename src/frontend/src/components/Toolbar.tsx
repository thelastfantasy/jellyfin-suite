import type { GroupByMode, MediaFilter, SortByMode, ViewSettings } from '../types'

interface Props {
  settings: ViewSettings
  onSettingsChange: (patch: Partial<ViewSettings>) => void
}

const GROUP_OPTIONS: { value: GroupByMode; label: string }[] = [
  { value: 'day', label: '按天' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' },
  { value: 'quarter', label: '按季度' },
  { value: 'year', label: '按年' },
]

const SORT_OPTIONS: { value: SortByMode; label: string }[] = [
  { value: 'playedDate', label: '播放时间' },
  { value: 'title', label: '标题' },
  { value: 'favorite', label: '收藏优先' },
  { value: 'releaseYear', label: '发行年份' },
  { value: 'addedDate', label: '添加时间' },
]

const MEDIA_OPTIONS: { value: MediaFilter; label: string }[] = [
  { value: 'video', label: '仅视频' },
  { value: 'audio', label: '仅音频' },
  { value: 'all', label: '全部' },
]

export function Toolbar({ settings, onSettingsChange }: Props) {
  return (
    <div class="jr-toolbar">
      <div class="jr-toolbar__group">
        <label class="jr-toolbar__label">分组</label>
        <select
          class="jr-toolbar__select"
          value={settings.groupBy}
          onChange={(e) => onSettingsChange({ groupBy: (e.target as HTMLSelectElement).value as GroupByMode })}
        >
          {GROUP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div class="jr-toolbar__group">
        <label class="jr-toolbar__label">排序</label>
        <select
          class="jr-toolbar__select"
          value={settings.sortBy}
          onChange={(e) => onSettingsChange({ sortBy: (e.target as HTMLSelectElement).value as SortByMode })}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          class="jr-toolbar__sort-order"
          onClick={() => onSettingsChange({ sortOrder: settings.sortOrder === 'desc' ? 'asc' : 'desc' })}
          title={settings.sortOrder === 'desc' ? '降序' : '升序'}
        >
          {settings.sortOrder === 'desc' ? '↓' : '↑'}
        </button>
      </div>

      <div class="jr-toolbar__group">
        <label class="jr-toolbar__label">类型</label>
        <select
          class="jr-toolbar__select"
          value={settings.mediaFilter}
          onChange={(e) => onSettingsChange({ mediaFilter: (e.target as HTMLSelectElement).value as MediaFilter })}
        >
          {MEDIA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div class="jr-toolbar__group">
        <label class="jr-toolbar__label jr-toolbar__label--toggle">
          <input
            type="checkbox"
            checked={settings.showRepeats}
            onChange={(e) => onSettingsChange({ showRepeats: (e.target as HTMLInputElement).checked })}
          />
          显示重复记录
        </label>
      </div>
    </div>
  )
}
