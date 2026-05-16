import { useState, useCallback } from 'preact/hooks'
import { MdAdd, MdRemove } from 'react-icons/md'
import { StartJobRequest, OverlaySettingsDto, fetchPreview, SkipSegment, loadGlobalSkipSegments, saveGlobalSkipSegments } from '../api/posterSheetApi'
import { isGridValid, maxFrames as calcMaxFrames } from '../utils/gridValidation'
import { useLocale } from '../i18n/context'
import { Lightbox } from './Lightbox'
import { downloadBlob } from '../utils/download'
import { TimeInput } from './SkipSegmentsModal'

const THEMES = ['classic', 'dark', 'light', 'cinematic', 'minimal', 'transparent'] as const
const LATIN_FONTS = [
  { value: 'noto-sans',  label: 'Noto Sans',        style: '' },
  { value: 'noto-serif', label: 'Noto Serif',        style: 'font-style:italic' },
  { value: 'roboto',     label: 'Roboto',            style: '' },
  { value: 'oswald',     label: 'Oswald',            style: 'font-weight:700;letter-spacing:0.05em' },
  { value: 'playfair',   label: 'Playfair',          style: 'font-style:italic' },
  { value: 'cinzel',     label: 'Cinzel',            style: 'letter-spacing:0.08em' },
] as const
const CJK_FONTS = [
  { value: 'noto-sans-jp',  label: 'Noto Sans' },
  { value: 'noto-serif-jp', label: 'Noto Serif' },
] as const
const OVERLAY_FONTS = [
  { value: 'noto-sans-jp',  label: 'Noto Sans' },
  { value: 'noto-serif-jp', label: 'Noto Serif' },
] as const
const MODES = ['deterministic', 'random'] as const
const LANGS = ['en', 'zh', 'ja'] as const

function hasCJK(s: string) {
  return /[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯]/.test(s)
}
function hasLatin(s: string) {
  return /[a-zA-Z]/.test(s)
}

type TimestampPos = 'inside-bottom-left' | 'outside-bottom-left' | 'inside-bottom-center' | 'outside-bottom-center' | 'inside-bottom-right' | 'outside-bottom-right'

interface Props {
  videoDuration: number | null
  onGenerate: (req: StartJobRequest) => void
  settingsOnly?: boolean
  onDisable?: () => void
}

function loadSettings() {
  return {
    rows: Number(localStorage.getItem('jr-poster-rows') ?? 6),
    cols: Number(localStorage.getItem('jr-poster-cols') ?? 8),
    mode: (localStorage.getItem('jr-poster-mode') ?? 'deterministic') as 'deterministic' | 'random',
    overlay: (() => {
      try {
        return JSON.parse(localStorage.getItem('jr-poster-overlay') ?? 'null') ?? defaultOverlay()
      } catch { return defaultOverlay() }
    })(),
  }
}

function defaultOverlay(): OverlaySettingsDto {
  return {
    brandingEnabled: true,
    brandingText: 'Jellyfin Recents',
    videoInfoEnabled: true,
    showFileSize: true,
    showResolutionFps: true,
    showVideoEncoding: true,
    showAudioEncoding: true,
    showDuration: true,
    showFrameTimestamp: false,
    colorTheme: 'classic',
    fontFamily: 'noto-sans-jp',
    brandingLatinFont: 'noto-sans',
    brandingCjkFont: 'noto-sans-jp',
    lang: 'en',
    timestampPosition: 'inside-bottom-left',
  }
}


function TimestampPosPicker({ value, onChange }: { value: TimestampPos; onChange: (v: TimestampPos) => void }) {
  const inside = [
    { v: 'inside-bottom-left'   as const, style: { bottom: 4, left: 4 } },
    { v: 'inside-bottom-center' as const, style: { bottom: 4, left: '50%', marginLeft: -14 } },
    { v: 'inside-bottom-right'  as const, style: { bottom: 4, right: 4 } },
  ]
  const outside = [
    { v: 'outside-bottom-left'  as const, style: { bottom: 2, left: 16 } },
    { v: 'outside-bottom-center' as const, style: { bottom: 2, left: '50%', marginLeft: -14 } },
    { v: 'outside-bottom-right' as const, style: { bottom: 2, right: 16 } },
  ]
  return (
    <div class="jr-tspicker">
      <div class="jr-tspicker__inner">
        {inside.map(p => (
          <button
            key={p.v}
            class={`jr-tspicker__btn${value === p.v ? ' jr-tspicker__btn--active' : ''}`}
            style={p.style}
            onClick={() => onChange(p.v)}
            title={p.v}
          >00:00</button>
        ))}
      </div>
      {/* Outside buttons between inner and outer borders */}
      {outside.map(p => (
        <button
          key={p.v}
          class={`jr-tspicker__btn${value === p.v ? ' jr-tspicker__btn--active' : ''}`}
          style={{...p.style, position: 'absolute'}}
          onClick={() => onChange(p.v)}
          title={p.v}
        >00:00</button>
      ))}
    </div>
  )
}

export function PosterSheetSettingsPanel({ videoDuration, onGenerate, settingsOnly = false, onDisable }: Props) {
  const { t } = useLocale()
  const init = loadSettings()
  const [rows, setRows] = useState(init.rows)
  const [cols, setCols] = useState(init.cols)
  const [mode, setMode] = useState(init.mode)
  const [overlay, setOverlay] = useState<OverlaySettingsDto>(init.overlay)
  const [headless, setHeadless] = useState(() => localStorage.getItem('jr-poster-headless') === '1')
  const [globalSkips, setGlobalSkips] = useState<SkipSegment[]>(() => loadGlobalSkipSegments())
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLightboxOpen, setPreviewLightboxOpen] = useState(false)

  const isShortVideo = videoDuration !== null && videoDuration < 120
  const frameMax = videoDuration !== null ? calcMaxFrames(videoDuration) : Infinity
  const frameCount = rows * cols
  const tooManyFrames = videoDuration !== null && !isGridValid(rows, cols, videoDuration)

  function persist(newRows: number, newCols: number, newMode: typeof mode, newOverlay: typeof overlay) {
    localStorage.setItem('jr-poster-rows', String(newRows))
    localStorage.setItem('jr-poster-cols', String(newCols))
    localStorage.setItem('jr-poster-mode', newMode)
    localStorage.setItem('jr-poster-overlay', JSON.stringify(newOverlay))
  }

  function updateRows(v: number) { setRows(v); persist(v, cols, mode, overlay) }
  function updateCols(v: number) { setCols(v); persist(rows, v, mode, overlay) }
  function updateMode(v: typeof mode) { setMode(v); persist(rows, cols, v, overlay) }
  function updateOverlay(patch: Partial<OverlaySettingsDto>) {
    const next = { ...overlay, ...patch }
    setOverlay(next)
    persist(rows, cols, mode, next)
  }
  function updateHeadless(v: boolean) {
    setHeadless(v)
    localStorage.setItem('jr-poster-headless', v ? '1' : '0')
  }

  function addGlobalSkip() {
    if (globalSkips.length >= 2) return
    const next = [...globalSkips, { startMs: 0, endMs: 0 }]
    setGlobalSkips(next); saveGlobalSkipSegments(next)
  }
  function removeGlobalSkip(idx: number) {
    const next = globalSkips.filter((_, i) => i !== idx)
    setGlobalSkips(next); saveGlobalSkipSegments(next)
  }
  function updateGlobalSkip(idx: number, patch: Partial<SkipSegment>) {
    const next = globalSkips.map((s, i) => i === idx ? { ...s, ...patch } : s)
    setGlobalSkips(next); saveGlobalSkipSegments(next)
  }

  const effectiveOverlay = headless
    ? { ...overlay, brandingEnabled: false, videoInfoEnabled: false }
    : overlay

  const handleGenerate = useCallback(() => {
    const validSkips = globalSkips.filter(s => s.endMs > s.startMs)
    const req: StartJobRequest = {
      rows, cols, mode,
      seed: mode === 'random' ? crypto.randomUUID() : undefined,
      overlay: effectiveOverlay,
      ...(validSkips.length > 0 ? { skipSegments: validSkips } : {}),
    }
    onGenerate(req)
  }, [rows, cols, mode, effectiveOverlay, globalSkips, onGenerate])

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const blob = await fetchPreview(effectiveOverlay, rows, cols)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const url = URL.createObjectURL(blob)
      setPreviewUrl(url)
      setPreviewLightboxOpen(true)
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? (e.message ?? t.posterPreview) : t.posterPreview)
    } finally {
      setPreviewLoading(false)
    }
  }, [effectiveOverlay, rows, cols, previewUrl, t])

  const validPresets = isShortVideo
    ? ([[2,3],[2,4],[3,4],[2,6],[3,3]] as [number,number][])
        .filter(([r,c]) => r * c <= frameMax)
    : null

  const brandText   = overlay.brandingText ?? ''
  const brandCJK    = hasCJK(brandText)
  const brandLatin  = hasLatin(brandText)
  const showLatin   = brandLatin || !brandCJK
  const showCJK     = brandCJK || !brandLatin

  return (
    <div class="jr-poster-settings">
      <h3 class="jr-poster-settings__title">{t.posterSettingsTitle}</h3>

      {/* Grid size */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterGrid}</label>
        {validPresets ? (
          <div class="jr-poster-settings__presets">
            {validPresets.map(([r, c]) => (
              <button
                key={`${r}x${c}`}
                class={`jr-poster-settings__preset-btn${rows === r && cols === c ? ' jr-poster-settings__preset-btn--active' : ''}`}
                onClick={() => { updateRows(r); updateCols(c) }}
              >
                {r}x{c}
              </button>
            ))}
          </div>
        ) : (
          <div class="jr-poster-settings__sliders">
            <div class="jr-poster-settings__slider-row">
              <span>{t.posterCols}: {cols}</span>
              <input type="range" min={1} max={12} value={cols}
                onInput={(e) => updateCols(Number((e.target as HTMLInputElement).value))} />
            </div>
            <div class="jr-poster-settings__slider-row">
              <span>{t.posterRows}: {rows}</span>
              <input type="range" min={1} max={20} value={rows}
                onInput={(e) => updateRows(Number((e.target as HTMLInputElement).value))} />
            </div>
            <div class="jr-poster-settings__frame-count">
              {frameCount} {t.posterFrames}
              {tooManyFrames && (
                <span class="jr-poster-settings__warn">
                  {' '}({t.posterTooMany} {frameMax})
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mode — toggle buttons */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterMode}</label>
        <div class="jr-poster-settings__theme-group">
          {MODES.map(m => (
            <button
              key={m}
              class={`jr-poster-settings__theme-btn${mode === m ? ' jr-poster-settings__theme-btn--active' : ''}`}
              onClick={() => updateMode(m)}
              title={m === 'deterministic' ? t.posterDeterministicTip : t.posterRandomTip}
            >
              {m === 'deterministic' ? t.posterDeterministic : t.posterRandom}
            </button>
          ))}
        </div>
        <p class="jr-poster-settings__mode-desc">
          {mode === 'deterministic' ? t.posterDeterministicTip : t.posterRandomTip}
        </p>
      </div>

      {/* Global skip segments */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterGlobalSkip}</label>
        <div class="jr-poster-settings__global-skips">
          {globalSkips.map((seg, idx) => (
            <div key={idx} class="jr-skip-segment-row">
              <TimeInput valueMs={seg.startMs} onChange={v => updateGlobalSkip(idx, { startMs: v })} />
              <span class="jr-skip-segment-dash">—</span>
              <TimeInput valueMs={seg.endMs} onChange={v => updateGlobalSkip(idx, { endMs: v })} />
              <button class="jr-skip-segment-remove" onClick={() => removeGlobalSkip(idx)} title="删除">
                <MdRemove size={15} />
              </button>
            </div>
          ))}
          {globalSkips.length < 2 && (
            <button class="jr-skip-segment-add" onClick={addGlobalSkip}>
              <MdAdd size={15} />{t.posterGlobalSkipAdd}
            </button>
          )}
        </div>
      </div>

      {/* Overlay settings */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterOverlay}</label>

        {/* Headless mode */}
        <div class="jr-poster-settings__check-row jr-poster-settings__check-row--headless">
          <input type="checkbox" id="headless" checked={headless}
            onChange={e => updateHeadless((e.target as HTMLInputElement).checked)} />
          <label for="headless">{t.posterHeadless}</label>
          <span class="jr-poster-settings__headless-tip">{t.posterHeadlessTip}</span>
        </div>

        {/* Branding */}
        <div class={`jr-poster-settings__check-row${headless ? ' jr-poster-settings__check-row--muted' : ''}`}>
          <input type="checkbox" id="branding" checked={overlay.brandingEnabled}
            disabled={headless}
            onChange={e => updateOverlay({ brandingEnabled: (e.target as HTMLInputElement).checked })} />
          <label for="branding">{t.posterBrandingLabel}</label>
          {overlay.brandingEnabled && (
            <input type="text" class="jr-poster-settings__text-input"
              value={overlay.brandingText} maxLength={200}
              onInput={e => updateOverlay({ brandingText: (e.target as HTMLInputElement).value })} />
          )}
        </div>
        {overlay.brandingEnabled && (
          <div class={`jr-poster-settings__sub-checks${headless ? ' jr-poster-settings__sub-checks--muted' : ''}`}>
            {showLatin && (
              <>
                <label class="jr-poster-settings__label" style="margin-bottom:0.3rem">
                  {brandCJK ? t.posterBrandingLatinFont : t.posterBrandingFont}
                </label>
                <div class="jr-poster-settings__font-group">
                  {LATIN_FONTS.map(f => (
                    <button
                      key={f.value}
                      disabled={headless}
                      class={`jr-poster-settings__font-btn${overlay.brandingLatinFont === f.value ? ' jr-poster-settings__font-btn--active' : ''}`}
                      style={f.style}
                      onClick={() => updateOverlay({ brandingLatinFont: f.value })}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {showCJK && (
              <>
                <label class="jr-poster-settings__label" style="margin-bottom:0.3rem;margin-top:0.4rem">
                  {brandLatin ? t.posterBrandingCjkFont : t.posterBrandingFont}
                </label>
                <div class="jr-poster-settings__font-group">
                  {CJK_FONTS.map(f => (
                    <button
                      key={f.value}
                      disabled={headless}
                      class={`jr-poster-settings__font-btn${overlay.brandingCjkFont === f.value ? ' jr-poster-settings__font-btn--active' : ''}`}
                      onClick={() => updateOverlay({ brandingCjkFont: f.value })}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Video info */}
        <div class={`jr-poster-settings__check-row${headless ? ' jr-poster-settings__check-row--muted' : ''}`}>
          <input type="checkbox" id="videoInfo" checked={overlay.videoInfoEnabled}
            disabled={headless}
            onChange={e => updateOverlay({ videoInfoEnabled: (e.target as HTMLInputElement).checked })} />
          <label for="videoInfo">{t.posterVideoInfo}</label>
        </div>
        {overlay.videoInfoEnabled && (
          <div class={`jr-poster-settings__sub-checks${headless ? ' jr-poster-settings__sub-checks--muted' : ''}`}>
            {([
              ['showFileSize', 'posterFileSize'],
              ['showResolutionFps', 'posterResolutionFps'],
              ['showVideoEncoding', 'posterVideoEncoding'],
              ['showAudioEncoding', 'posterAudioEncoding'],
              ['showDuration', 'posterDuration'],
            ] as [keyof OverlaySettingsDto, keyof typeof t][]).map(([key, labelKey]) => (
              <div key={key} class="jr-poster-settings__check-row">
                <input type="checkbox" id={key} checked={overlay[key] as boolean}
                  disabled={headless}
                  onChange={e => updateOverlay({ [key]: (e.target as HTMLInputElement).checked })} />
                <label for={key}>{t[labelKey]}</label>
              </div>
            ))}
          </div>
        )}

        {/* Timestamp badge */}
        <div class="jr-poster-settings__check-row">
          <input type="checkbox" id="timestamp" checked={overlay.showFrameTimestamp}
            onChange={e => updateOverlay({ showFrameTimestamp: (e.target as HTMLInputElement).checked })} />
          <label for="timestamp">{t.posterTimestamp}</label>
        </div>

        {/* Timestamp position — graphical picker */}
        {overlay.showFrameTimestamp && (
          <div class="jr-poster-settings__sub-checks">
            <label class="jr-poster-settings__label" style="margin-bottom:0.3rem">{t.posterTimestampPos}</label>
            <TimestampPosPicker
              value={overlay.timestampPosition as TimestampPos}
              onChange={v => updateOverlay({ timestampPosition: v })}
            />
          </div>
        )}
      </div>

      {/* Color theme — toggle buttons */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterTheme}</label>
        <div class="jr-poster-settings__theme-group">
          {THEMES.map(theme => (
            <button
              key={theme}
              class={`jr-poster-settings__theme-btn${overlay.colorTheme === theme ? ' jr-poster-settings__theme-btn--active' : ''}`}
              onClick={() => updateOverlay({ colorTheme: theme })}
            >
              {theme.charAt(0).toUpperCase() + theme.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Font family for overlay labels/timestamps — CJK-capable only */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterFont}</label>
        <div class="jr-poster-settings__font-group">
          {OVERLAY_FONTS.map(f => (
            <button
              key={f.value}
              class={`jr-poster-settings__font-btn${overlay.fontFamily === f.value ? ' jr-poster-settings__font-btn--active' : ''}`}
              onClick={() => updateOverlay({ fontFamily: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overlay language — toggle buttons */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterLang}</label>
        <div class="jr-poster-settings__theme-group">
          {LANGS.map(lang => (
            <button
              key={lang}
              class={`jr-poster-settings__theme-btn${overlay.lang === lang ? ' jr-poster-settings__theme-btn--active' : ''}`}
              onClick={() => updateOverlay({ lang })}
            >
              {lang === 'en' ? t.posterLangEn : lang === 'zh' ? t.posterLangZh : t.posterLangJa}
            </button>
          ))}
        </div>
      </div>

      {/* Preview + Disable row */}
      <div class="jr-poster-settings__section">
        <div class="jr-poster-settings__preview-row">
          <button class="jr-poster-settings__preview-btn" onClick={handlePreview} disabled={previewLoading}>
            {previewLoading ? t.posterPreviewLoading : t.posterPreview}
          </button>
          <span class="jr-poster-settings__row-spacer" />
          {onDisable && (
            <button class="jr-poster-settings__disable-btn" onClick={onDisable} title={t.posterDisable}>
              {t.posterDisable}
            </button>
          )}
        </div>
        {previewError && <p class="jr-poster-settings__preview-error">{previewError}</p>}
      </div>

      {previewLightboxOpen && previewUrl && (
        <Lightbox
          src={previewUrl}
          alt={t.posterPreview}
          onClose={() => setPreviewLightboxOpen(false)}
          onDownload={() => downloadBlob(previewUrl, 'poster-preview.webp')}
        />
      )}

      {!settingsOnly && (
        <button
          class="jr-poster-settings__generate-btn"
          onClick={handleGenerate}
          disabled={tooManyFrames}
        >
          {t.posterGenerate} ({rows}x{cols} = {frameCount} {t.posterFrames})
        </button>
      )}

    </div>
  )
}
