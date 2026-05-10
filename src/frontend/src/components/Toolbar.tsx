import { MdArrowDownward, MdArrowUpward, MdGridView, MdViewModule, MdViewList } from 'react-icons/md'
import type { GroupByMode, MediaFilter, SortByMode, ViewMode, ViewSettings } from '../types'

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
  { value: 'favoritedAt', label: '收藏时间' },
  { value: 'releaseDate', label: '发行时间' },
  { value: 'addedDate', label: '添加时间' },
]

const MEDIA_OPTIONS: { value: MediaFilter; label: string }[] = [
  { value: 'video', label: '仅视频' },
  { value: 'audio', label: '仅音频' },
  { value: 'all', label: '全部' },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = (props: { size?: number }) => any

const VIEW_MODE_OPTIONS: { value: ViewMode; icon: IconComponent; title: string }[] = [
  { value: 'thumbnail', icon: MdGridView as IconComponent, title: '缩略图（16:9）' },
  { value: 'poster', icon: MdViewModule as IconComponent, title: '海报（2:3）' },
  { value: 'list', icon: MdViewList as IconComponent, title: '列表' },
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
          {settings.sortOrder === 'desc' ? <MdArrowDownward size={16} /> : <MdArrowUpward size={16} />}
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
        <label class="jr-toolbar__label">视图</label>
        <div class="jr-toolbar__view-modes">
          {VIEW_MODE_OPTIONS.map((o) => (
            <button
              key={o.value}
              class={`jr-toolbar__view-btn${settings.viewMode === o.value ? ' jr-toolbar__view-btn--active' : ''}`}
              title={o.title}
              onClick={() => onSettingsChange({ viewMode: o.value })}
            >
              <o.icon size={18} />
            </button>
          ))}
        </div>
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
