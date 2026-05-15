import { useEffect, useCallback, useRef, useState } from 'preact/hooks'
import { MdClose, MdDownload, MdDelete, MdZoomIn, MdZoomOut, MdFitScreen } from 'react-icons/md'

interface Props {
  src: string
  alt?: string
  onClose: () => void
  onDownload?: () => void
  onDelete?: () => void
}

export function Lightbox({ src, alt = '', onClose, onDownload, onDelete }: Props) {
  const viewRef   = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const imgRef    = useRef<HTMLImageElement>(null)

  // All transform state in refs — avoids re-renders during drag/zoom
  const scaleRef    = useRef(1)
  const panRef      = useRef({ x: 0, y: 0 })
  const fitScaleRef = useRef(1)
  const natRef      = useRef({ w: 0, h: 0 })
  const dragRef     = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)

  // Only cursor needs React state (tiny)
  const [dragging, setDragging] = useState(false)

  const applyTransform = useCallback(() => {
    if (!canvasRef.current) return
    const { x, y } = panRef.current
    const s = scaleRef.current
    canvasRef.current.style.transform = `translate(${x}px,${y}px) scale(${s})`
  }, [])

  // Center the image at the given scale
  const centerAt = useCallback((s: number) => {
    const view = viewRef.current
    const { w, h } = natRef.current
    if (!view || w === 0) return
    panRef.current = {
      x: (view.clientWidth  - w * s) / 2,
      y: (view.clientHeight - h * s) / 2,
    }
  }, [])

  const computeFit = useCallback(() => {
    const view = viewRef.current
    const { w, h } = natRef.current
    if (!view || w === 0) return 1
    return Math.min(view.clientWidth / w, view.clientHeight / h, 1)
  }, [])

  // Keyboard dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // Wheel zoom: keeps the pixel under the cursor stationary
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const view = viewRef.current
    if (!view) return

    const oldS  = scaleRef.current
    const newS  = Math.max(0.05, Math.min(20, oldS * (1 - e.deltaY * 0.001)))
    const ratio = newS / oldS

    const rect = view.getBoundingClientRect()
    const cx   = e.clientX - rect.left
    const cy   = e.clientY - rect.top

    // Keep cursor point fixed: newPan = cursor - (cursor - oldPan) * ratio
    panRef.current = {
      x: cx - (cx - panRef.current.x) * ratio,
      y: cy - (cy - panRef.current.y) * ratio,
    }
    scaleRef.current = newS
    applyTransform()
  }, [applyTransform])

  // Drag panning
  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setDragging(true)
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: panRef.current.x, py: panRef.current.y }
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      panRef.current = { x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }
      applyTransform()
    }
    const onUp = () => { dragRef.current = null; setDragging(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',  onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [applyTransform])

  // Initial fit after image loads
  const onImgLoad = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    natRef.current = { w: img.naturalWidth, h: img.naturalHeight }
    const fit = computeFit()
    fitScaleRef.current = fit
    scaleRef.current   = fit
    centerAt(fit)
    applyTransform()
  }, [computeFit, centerAt, applyTransform])

  // Toolbar buttons zoom toward/away from view center
  const zoomBy = useCallback((factor: number) => {
    const view = viewRef.current
    if (!view) return
    const oldS  = scaleRef.current
    const newS  = Math.max(0.05, Math.min(20, oldS * factor))
    const ratio = newS / oldS
    const cx    = view.clientWidth  / 2
    const cy    = view.clientHeight / 2
    panRef.current = { x: cx - (cx - panRef.current.x) * ratio, y: cy - (cy - panRef.current.y) * ratio }
    scaleRef.current = newS
    applyTransform()
  }, [applyTransform])

  const handleFit = useCallback(() => {
    const fit = computeFit()
    fitScaleRef.current = fit
    scaleRef.current   = fit
    centerAt(fit)
    applyTransform()
  }, [computeFit, centerAt, applyTransform])

  const hasFooter = onDownload || onDelete

  return (
    <div
      class="jr-lightbox"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      {/* Zoom toolbar */}
      <div class="jr-lightbox__zoombar" onClick={e => e.stopPropagation()}>
        <button class="jr-lightbox__zoom-btn" onClick={() => zoomBy(1.3)} title="Zoom in">
          <MdZoomIn size={20} />
        </button>
        <button class="jr-lightbox__zoom-btn" onClick={() => zoomBy(1 / 1.3)} title="Zoom out">
          <MdZoomOut size={20} />
        </button>
        <button class="jr-lightbox__zoom-btn" onClick={handleFit} title="Fit to screen">
          <MdFitScreen size={18} />
        </button>
      </div>

      <button
        class="jr-lightbox__close"
        onClick={e => { e.stopPropagation(); onClose() }}
        aria-label="Close"
      >
        <MdClose size={20} />
      </button>

      {/* Pan / zoom viewport */}
      <div
        ref={viewRef}
        class="jr-lightbox__view"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onClick={e => e.stopPropagation()}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <div ref={canvasRef} class="jr-lightbox__canvas">
          <img
            ref={imgRef}
            class="jr-lightbox__img"
            src={src}
            alt={alt}
            onLoad={onImgLoad}
            draggable={false}
          />
        </div>
      </div>

      {hasFooter && (
        <div class="jr-lightbox__footer" onClick={e => e.stopPropagation()}>
          {onDownload && (
            <button class="jr-lightbox__footer-btn" onClick={onDownload} title="Download">
              <MdDownload size={20} />
            </button>
          )}
          {onDelete && (
            <button
              class="jr-lightbox__footer-btn jr-lightbox__footer-btn--delete"
              onClick={onDelete}
              title="Delete"
            >
              <MdDelete size={20} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
