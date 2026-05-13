import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import type { AncestorEntry } from '../api/foldersApi'
import { getItemAncestors } from '../api/foldersApi'
import { useLocale } from '../i18n/context'

interface Props {
  itemId: string
  showTypeLabel?: boolean
  viewMode?: string
}

const POPOVER_WIDTH = 260
const POPOVER_ITEM_HEIGHT = 32

function computeStyle(btn: HTMLElement, entryCount: number, isList: boolean): Record<string, string> {
  const r = btn.getBoundingClientRect()
  const estH = Math.min(Math.max(entryCount, 1), 8) * POPOVER_ITEM_HEIGHT + 40

  const style: Record<string, string> = {}

  if (isList) {
    style.right = `${window.innerWidth - r.right}px`
  } else {
    let left = r.left
    if (left + POPOVER_WIDTH > window.innerWidth - 8) {
      left = r.right - POPOVER_WIDTH
    }
    if (left < 4) left = 4
    style.left = `${left}px`
  }

  let top = r.bottom + 4
  if (top + estH > window.innerHeight - 8) {
    top = r.top - estH - 4
  }
  if (top < 4) top = 4
  style.top = `${top}px`

  style.position = 'fixed'
  style.zIndex = '999999'
  return style
}

export function FolderViewPopover({ itemId, showTypeLabel, viewMode }: Props) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [ancestors, setAncestors] = useState<AncestorEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [style, setStyle] = useState<Record<string, string>>({})
  const btnRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const fetchingRef = useRef(false)

  const close = useCallback(() => {
    setOpen(false)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)
          && btnRef.current && !btnRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [open, close])

  function updatePosition(count: number) {
    if (!btnRef.current) return
    setStyle(computeStyle(btnRef.current, count, viewMode === 'list'))
  }

  async function handleToggle(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (open) { close(); return }
    if (fetchingRef.current) return

    setOpen(true)
    setLoading(true)
    fetchingRef.current = true
    requestAnimationFrame(() => updatePosition(3))

    try {
      const list = await getItemAncestors(itemId)
      const filtered = list.length > 1 ? list.slice(0, -1) : list
      setAncestors(filtered)
      setLoading(false)
      requestAnimationFrame(() => updatePosition(filtered.length))
    } catch {
      setLoading(false)
      close()
    } finally {
      fetchingRef.current = false
    }
  }

  const isList = viewMode === 'list'

  const popover = open && createPortal(
    <div ref={popoverRef} class="jr-folder-popover" style={style}>
      <div class="jr-folder-popover__title">{t.folderViewTitle}</div>
      {loading ? (
        <div class="jr-folder-popover__loading">
          <span class="jr-folder-popover__sk" />
          <span class="jr-folder-popover__sk" />
          <span class="jr-folder-popover__sk" />
        </div>
      ) : (
        <ul class="jr-folder-popover__list">
          {ancestors.map((a, i) => (
            <li key={a.Id} class={`jr-folder-popover__item jr-folder-popover__item--l${i}`}>
              <a
                class="jr-folder-popover__link"
                href={`#!/list.html?parentId=${a.Id}&serverId=${a.ServerId}`}
                onClick={close}
                title={a.Name}
              >
                <span class="jr-folder-popover__lvl" />
                {a.Name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  )

  return (
    <div class={`jr-folder-btn-wrap${showTypeLabel && !isList ? ' jr-folder-btn-wrap--with-type' : ''}${isList ? ' jr-folder-btn-wrap--list' : ''}`}>
      <button
        ref={btnRef}
        class={`jr-folder-btn${isList ? ' jr-folder-btn--list' : ''}`}
        onClick={handleToggle}
        title={t.folderViewTitle}
      >
        {loading ? (
          <span class="jr-folder-btn__spinner" />
        ) : (
          <span class="material-icons">folder</span>
        )}
      </button>
      {popover}
    </div>
  )
}
