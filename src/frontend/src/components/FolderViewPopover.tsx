import { useState, useEffect, useRef } from 'preact/hooks'
import type { AncestorEntry } from '../api/foldersApi'
import { getItemAncestors } from '../api/foldersApi'
import { useLocale } from '../i18n/context'

interface Props {
  itemId: string
  showTypeLabel?: boolean
}

export function FolderViewPopover({ itemId, showTypeLabel }: Props) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [ancestors, setAncestors] = useState<AncestorEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<Record<string, string>>({})
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

  function handleToggle(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!open) {
      if (ancestors.length === 0) {
        setLoading(true)
        getItemAncestors(itemId).then((list) => {
          setAncestors(list)
          setLoading(false)
        }).catch(() => setLoading(false))
      }
      setOpen(true)
      requestAnimationFrame(() => {
        if (!btnRef.current) return
        const rect = btnRef.current.getBoundingClientRect()
        setPopoverStyle({
          position: 'fixed',
          top: `${rect.bottom + 4}px`,
          left: `${Math.max(4, rect.left)}px`,
        })
      })
    } else {
      setOpen(false)
    }
  }

  return (
    <div class={`jr-folder-btn-wrap${showTypeLabel ? ' jr-folder-btn-wrap--with-type' : ''}`}>
      <button
        ref={btnRef}
        class="jr-folder-btn"
        onClick={handleToggle}
        title={t.folderViewTitle}
      >
        <span class="material-icons">folder</span>
      </button>
      {open && (
        <div ref={popoverRef} class="jr-folder-popover" style={popoverStyle}>
          <div class="jr-folder-popover__title">{t.folderViewTitle}</div>
          {loading ? (
            <div class="jr-folder-popover__loading">{t.loading}</div>
          ) : ancestors.length === 0 ? (
            <div class="jr-folder-popover__empty">{t.folderViewEmpty}</div>
          ) : (
            <ul class="jr-folder-popover__list">
              {ancestors.map((ancestor) => (
                <li key={ancestor.Id}>
                  <a
                    class="jr-folder-popover__link"
                    href={`#!/list?parentId=${ancestor.Id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {ancestor.Name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
