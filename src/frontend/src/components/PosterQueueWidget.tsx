import { useState, useEffect, useCallback } from 'preact/hooks'
import { MdGridView } from 'react-icons/md'
import { Popover } from './Popover'
import { getJobs, removeJob, JobEntry } from '../state/posterJobStore'
import { cancelJob, getImageUrl } from '../api/posterSheetApi'
import { useLocale } from '../i18n/context'
import { PosterJobRunner } from './PosterJobRunner'
import { Lightbox } from './Lightbox'

export function PosterQueueWidget() {
  const { t } = useLocale()
  const [jobs, setJobs] = useState<JobEntry[]>(getJobs)
  const [open, setOpen] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  useEffect(() => {
    function handler() { setJobs(getJobs()) }
    window.addEventListener('jr-poster-jobs-changed', handler)
    return () => window.removeEventListener('jr-poster-jobs-changed', handler)
  }, [])

  const handleDelete = useCallback(async (job: JobEntry) => {
    if (job.status === 'running') await cancelJob(job.jobId).catch(() => {})
    removeJob(job.jobId)
  }, [])

  // Badge: running + error jobs
  const badgeCount = jobs.filter(j => j.status === 'running' || j.status === 'error').length

  if (jobs.length === 0) return null

  const runningJobs = jobs.filter(j => j.status === 'running')

  return (
    <>
      {runningJobs.map(j => <PosterJobRunner key={j.jobId} jobId={j.jobId} />)}
      <button
        class="jr-queue-widget"
        onClick={() => setOpen(v => !v)}
        title={t.posterQueue}
        aria-label={t.posterQueue}
      >
        <MdGridView size={22} />
        {badgeCount > 0 && (
          <span class="jr-queue-widget__badge">{badgeCount}</span>
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)}>
        <div class="jr-queue-popover">
          <div class="jr-queue-popover__header">
            <span>{t.posterQueue}</span>
            <button class="jr-queue-popover__header-close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div class="jr-queue-popover__list">
            {jobs.map(job => (
              <div key={job.jobId} class={`jr-queue-popover__item jr-queue-popover__item--${job.status}`}>
                <div class="jr-queue-popover__item-header">
                  <span class="jr-queue-popover__title" title={job.itemTitle}>{job.itemTitle}</span>
                  <button
                    class="jr-queue-popover__delete"
                    onClick={() => handleDelete(job)}
                    title="Remove"
                  >✕</button>
                </div>

                {job.status === 'running' && job.total > 0 && (
                  <div class="jr-queue-popover__bar">
                    <div
                      class="jr-queue-popover__bar-fill"
                      style={{ width: `${Math.round((job.progress / job.total) * 100)}%` }}
                    />
                    <span class="jr-queue-popover__bar-text">
                      {job.progress}/{job.total}
                    </span>
                  </div>
                )}

                {job.status === 'running' && job.total === 0 && (
                  <div class="jr-queue-popover__status-text">Starting…</div>
                )}

                {job.status === 'error' && (
                  <div class="jr-queue-popover__status-text jr-queue-popover__status-text--error">
                    {job.error ?? 'Error'}
                  </div>
                )}

                {job.status === 'done' && (
                  <img
                    src={getImageUrl(job.jobId)}
                    alt={job.itemTitle}
                    class="jr-queue-popover__thumb"
                    onClick={() => setLightboxSrc(getImageUrl(job.jobId))}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </Popover>

      {lightboxSrc && (
        <Lightbox
          src={lightboxSrc}
          alt="Poster sheet"
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  )
}
