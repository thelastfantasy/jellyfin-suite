import { createPortal } from 'preact/compat'
import type { ComponentChildren } from 'preact'

interface Props {
  open: boolean
  onClose: () => void
  children: ComponentChildren
}

export function Popover({ open, onClose, children }: Props) {
  if (!open) return null
  return createPortal(
    <div>
      <div class="jr-popover-overlay" onClick={onClose} />
      {children}
    </div>,
    document.body,
  )
}
