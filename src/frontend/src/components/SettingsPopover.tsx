import { useState, useRef, useEffect } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import type { GroupByMode } from '../types'
import { useLocale } from '../i18n/context'

interface Props {
  groupBy: GroupByMode
  pageSize: number
  onChange: (size: number) => void
}

const PRESETS: Record<GroupByMode, number[]> = {
  day: [7, 14, 30, 60],
  week: [4, 8, 13, 26],
  month: [3, 6, 12, 24],
  quarter: [1, 2, 3, 4],
  year: [1, 2, 3, 5],
}

export function SettingsPopover({ groupBy, pageSize, onChange }: Props) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const label = t.groupPerPage[groupBy]
  const presets = PRESETS[groupBy]
  const effective = pageSize > 0 ? pageSize : presets[presets.length - 1]

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)
          && btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [open])

  function handleToggle(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setOpen((v) => !v)
  }

  function commitSize(val: number) {
    onChange(val)
  }

  const popover = open && createPortal(
    <div
      ref={popoverRef}
      class="jr-settings-popover"
      style={{
        position: 'fixed',
        top: `${btnRef.current!.getBoundingClientRect().bottom + 4}px`,
        right: `${window.innerWidth - btnRef.current!.getBoundingClientRect().right}px`,
        zIndex: '999999',
      }}
    >
      <div class="jr-settings-popover__title">{t.settingsTitle}</div>
      <div class="jr-settings-popover__mode">{label}</div>
      <div class="jr-settings-popover__presets">
        {presets.map((n) => (
          <button
            key={n}
            class={`jr-settings-popover__btn${effective === n ? ' jr-settings-popover__btn--active' : ''}`}
            onClick={() => commitSize(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div class="jr-settings-popover__row">
        <input
          class="jr-settings-popover__input"
          type="number"
          min="1"
          max="999"
          value={pageSize > 0 ? pageSize : ''}
          placeholder={`${effective}`}
          onInput={(e) => {
            const v = parseInt((e.target as HTMLInputElement).value, 10)
            if (v > 0) commitSize(v)
          }}
        />
        <span class="jr-settings-popover__unit">{label}</span>
      </div>
    </div>,
    document.body,
  )

  return (
    <div class="jr-settings-btn-wrap">
      <button
        ref={btnRef}
        class={`jr-toolbar__view-btn${open ? ' jr-toolbar__view-btn--active' : ''}`}
        onClick={handleToggle}
        title={t.settingsTitle}
      >
        <span class="material-icons">settings</span>
      </button>
      {popover}
    </div>
  )
}
