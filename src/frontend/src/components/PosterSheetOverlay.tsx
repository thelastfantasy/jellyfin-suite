import { useState, useEffect, useCallback } from 'preact/hooks'
import { startJob, pollStatus, getImageUrl, JobStatusDto, loadStartJobRequest } from '../api/posterSheetApi'
import { addJob, updateJob } from '../state/posterJobStore'
import { useLocale } from '../i18n/context'

interface Props {
  itemId: string
  itemTitle: string
  onClose: () => void
}

type Phase = 'running' | 'done' | 'error'
type Transport = 'sse' | 'poll'

declare const window: Window & { ApiClient?: { accessToken(): string } }

export function PosterSheetOverlay({ itemId, itemTitle, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('running')
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatusDto | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [transport, setTransport] = useState<Transport>('sse')

  // Auto-start on mount
  useEffect(() => {
    const req = loadStartJobRequest()
    startJob(itemId, req).then(id => {
      setJobId(id)
      addJob(id, itemId, itemTitle)
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(msg)
      setPhase('error')
    })
  }, [itemId, itemTitle])

  // SSE stream — primary transport
  useEffect(() => {
    if (!jobId || phase !== 'running' || transport !== 'sse') return

    const token = window.ApiClient?.accessToken()
    const qs = token ? `?api_key=${encodeURIComponent(token)}` : ''
    const es = new EventSource(`/JellyfinRecents/PosterSheet/${jobId}/stream${qs}`)

    es.onmessage = (event: MessageEvent) => {
      try {
        const s: JobStatusDto = JSON.parse(event.data as string)
        setStatus(s)
        updateJob(jobId, { progress: s.progress, total: s.total, status: s.status === 'running' || s.status === 'queued' ? 'running' : s.status as 'done' | 'error' | 'cancelled' })
        if (s.status === 'done') {
          updateJob(jobId, { imageUrl: getImageUrl(jobId) })
          setPhase('done')
          es.close()
        } else if (s.status === 'error') {
          updateJob(jobId, { error: s.error ?? undefined })
          setErrorMsg(s.error ?? null)
          setPhase('error')
          es.close()
        } else if (s.status === 'cancelled') {
          onClose()
          es.close()
        }
      } catch { /* ignore parse errors */ }
    }

    es.onerror = () => {
      es.close()
      setTransport('poll') // fall back to polling
    }

    return () => es.close()
  }, [jobId, phase, transport])

  // Polling fallback (used if SSE fails)
  useEffect(() => {
    if (!jobId || phase !== 'running' || transport !== 'poll') return

    const interval = setInterval(async () => {
      try {
        const s = await pollStatus(jobId)
        setStatus(s)
        updateJob(jobId, { progress: s.progress, total: s.total })
        if (s.status === 'done') {
          updateJob(jobId, { status: 'done', imageUrl: getImageUrl(jobId) })
          setPhase('done')
        } else if (s.status === 'error') {
          updateJob(jobId, { status: 'error', error: s.error ?? undefined })
          setErrorMsg(s.error ?? null)
          setPhase('error')
        } else if (s.status === 'cancelled') onClose()
      } catch { /* keep polling */ }
    }, 1000)

    return () => clearInterval(interval)
  }, [jobId, phase, transport])

  // Close overlay without cancelling — job continues in queue widget
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleRetry = useCallback(() => {
    setPhase('running')
    setJobId(null)
    setStatus(null)
    setErrorMsg(null)
    setTransport('sse')
    const req = loadStartJobRequest()
    startJob(itemId, req).then(id => {
      setJobId(id)
      addJob(id, itemId, itemTitle)
    }).catch((e: unknown) => {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setPhase('error')
    })
  }, [itemId, itemTitle])

  const { t } = useLocale()

  return (
    <div class="jr-poster-overlay" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div class="jr-poster-overlay__panel">
        <button class="jr-poster-overlay__close" onClick={handleClose} title={t.lightboxClose}>✕</button>

        {phase === 'running' && (
          <div class="jr-poster-overlay__progress">
            <div class="jr-poster-overlay__progress-text">
              {status ? `${status.progress} / ${status.total} frames` : 'Starting generation...'}
            </div>
            {status && status.total > 0 && (
              <div class="jr-poster-overlay__progress-bar">
                <div class="jr-poster-overlay__progress-fill"
                  style={{ width: `${(status.progress / status.total) * 100}%` }} />
              </div>
            )}
          </div>
        )}

        {phase === 'done' && jobId && (
          <div class="jr-poster-overlay__result">
            <img src={getImageUrl(jobId)} alt="Poster sheet" class="jr-poster-overlay__image" />
          </div>
        )}

        {phase === 'error' && (
          <div class="jr-poster-overlay__error">
            <p class="jr-poster-overlay__error-msg">{errorMsg ?? 'Generation failed'}</p>
            <button class="jr-poster-overlay__retry-btn" onClick={handleRetry}>Retry</button>
          </div>
        )}
      </div>
    </div>
  )
}
