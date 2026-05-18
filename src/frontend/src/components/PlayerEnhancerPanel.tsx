import { useState, useEffect } from 'preact/hooks'
import { useLocale } from '../i18n/context'
import { getEnhancerStatus, injectEnhancer, removeEnhancer } from '../api/playerEnhancerApi'

interface Props {
  onClose: () => void
}

type Hint = 'reload' | 'error' | null

export function PlayerEnhancerPanel({ onClose }: Props) {
  const { t } = useLocale()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<Hint>(null)

  useEffect(() => {
    getEnhancerStatus()
      .then((s) => setEnabled(s.autoInjectEnabled))
      .catch(() => setEnabled(false))
  }, [])

  async function handleInject() {
    setBusy(true)
    setHint(null)
    try {
      await injectEnhancer()
      setEnabled(true)
      setHint('reload')
    } catch {
      setHint('error')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    setHint(null)
    try {
      await removeEnhancer()
      setEnabled(false)
      setHint('reload')
    } catch {
      setHint('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="jfs-poster-settings-modal jfs-enhancer-panel">
      <div class="jfs-poster-settings-modal__header">
        <span>{t.enhancerTitle}</span>
        <button class="jfs-poster-settings-modal__close" onClick={onClose}>✕</button>
      </div>
      <div class="jfs-poster-settings-modal__body jfs-enhancer-panel__body">
        <p class={`jfs-enhancer-panel__status${enabled ? ' jfs-enhancer-panel__status--on' : ''}`}>
          {enabled === null ? '…' : enabled ? t.enhancerStatusEnabled : t.enhancerStatusDisabled}
        </p>
        <div class="jfs-enhancer-panel__actions">
          <button class="jfs-btn" disabled={busy} onClick={handleInject}>
            {t.enhancerInject}
          </button>
          <button class="jfs-btn jfs-btn--danger" disabled={busy} onClick={handleRemove}>
            {t.enhancerRemove}
          </button>
        </div>
        {hint === 'reload' && <p class="jfs-enhancer-panel__hint jfs-enhancer-panel__hint--ok">{t.enhancerReloadHint}</p>}
        {hint === 'error' && <p class="jfs-enhancer-panel__hint jfs-enhancer-panel__hint--err">{t.enhancerErrorHint}</p>}
      </div>
    </div>
  )
}
