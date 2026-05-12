import { useState, useEffect, useRef } from 'preact/hooks'
import type { AncestorEntry } from '../api/foldersApi'
import { getItemAncestors } from '../api/foldersApi'
import { useLocale } from '../i18n/context'

interface Props {
  itemId: string
  showTypeLabel?: boolean
  viewMode?: string
}

export function FolderViewPopover({ itemId, showTypeLabel, viewMode }: Props) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [ancestors, setAncestors] = useState<AncestorEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<Record<string, string>>({
    position: 'fixed',
    visibility: 'hidden',
  })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

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

  function computePosition() {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPopoverStyle({
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${Math.max(4, rect.left)}px`,
      visibility: 'visible',
    })
  }

  function handleToggle(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!open) {
      if (ancestors.length === 0) {
        setLoading(true)
        getItemAncestors(itemId).then((list) => {
          const filtered = list.length > 1 ? list.slice(0, -1) : list
          setAncestors(filtered)
          setLoading(false)
          setOpen(true)
          requestAnimationFrame(computePosition)
        }).catch(() => setLoading(false))
      } else {
        setOpen(true)
        requestAnimationFrame(computePosition)
      }
    } else {
      setOpen(false)
    }
  }

  return (
    <div class={`jr-folder-btn-wrap${showTypeLabel && viewMode !== 'list' ? ' jr-folder-btn-wrap--with-type' : ''}${viewMode === 'list' ? ' jr-folder-btn-wrap--list' : ''}`}>
      <button
        ref={btnRef}
        class={`jr-folder-btn${viewMode === 'list' ? ' jr-folder-btn--list' : ''}`}
        onClick={handleToggle}
        title={t.folderViewTitle}
      >
        {loading ? (
          <span class="jr-folder-btn__spinner" />
        ) : (
          <span class="material-icons">folder</span>
        )}
      </button>
      {open && (
        <div ref={popoverRef} class="jr-folder-popover" style={popoverStyle}>
          <div class="jr-folder-popover__title">{t.folderViewTitle}</div>
          <ul class="jr-folder-popover__list">
            {ancestors.map((ancestor) => (
              <li key={ancestor.Id}>
                <a
                  class="jr-folder-popover__link"
                  href={`#!/list.html?parentId=${ancestor.Id}`}
                >
                  {ancestor.Name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
