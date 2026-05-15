import { useState, useCallback } from 'preact/hooks'
import { StartJobRequest, OverlaySettingsDto, fetchPreview } from '../api/posterSheetApi'
import { isGridValid, maxFrames as calcMaxFrames } from '../utils/gridValidation'
import { useLocale } from '../i18n/context'
import { Lightbox } from './Lightbox'
import { downloadBlob } from '../utils/download'

const THEMES = ['classic', 'dark', 'light', 'cinematic', 'minimal', 'transparent'] as const
const FONTS = [
  { value: 'noto-sans' as const, label: 'Noto Sans' },
  { value: 'noto-serif' as const, label: 'Noto Serif' },
]
const MODES = ['deterministic', 'random'] as const
const LANGS = ['en', 'zh', 'ja'] as const

type TimestampPos = 'inside-bottom-left' | 'outside-bottom-left' | 'inside-bottom-center' | 'outside-bottom-center' | 'inside-bottom-right' | 'outside-bottom-right'

interface Props {
  videoDuration: number | null
  onGenerate: (req: StartJobRequest) => void
  settingsOnly?: boolean
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
    fontFamily: 'noto-sans',
    brandingFontFamily: 'noto-sans',
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

export function PosterSheetSettingsPanel({ videoDuration, onGenerate, settingsOnly = false }: Props) {
  const { t } = useLocale()
  const init = loadSettings()
  const [rows, setRows] = useState(init.rows)
  const [cols, setCols] = useState(init.cols)
  const [mode, setMode] = useState(init.mode)
  const [overlay, setOverlay] = useState<OverlaySettingsDto>(init.overlay)
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

  const handleGenerate = useCallback(() => {
    const req: StartJobRequest = {
      rows, cols, mode,
      seed: mode === 'random' ? crypto.randomUUID() : undefined,
      overlay,
    }
    onGenerate(req)
  }, [rows, cols, mode, overlay, onGenerate])

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const blob = await fetchPreview(overlay, rows, cols)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const url = URL.createObjectURL(blob)
      setPreviewUrl(url)
      setPreviewLightboxOpen(true)
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? (e.message ?? t.posterPreview) : t.posterPreview)
    } finally {
      setPreviewLoading(false)
    }
  }, [overlay, rows, cols, previewUrl, t])

  const validPresets = isShortVideo
    ? ([[2,3],[2,4],[3,4],[2,6],[3,3]] as [number,number][])
        .filter(([r,c]) => r * c <= frameMax)
    : null

  const brandFontOptions = FONTS

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
              <input type="range" min={1} max={10} value={rows}
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
      </div>

      {/* Overlay settings */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterOverlay}</label>

        {/* Branding */}
        <div class="jr-poster-settings__check-row">
          <input type="checkbox" id="branding" checked={overlay.brandingEnabled}
            onChange={e => updateOverlay({ brandingEnabled: (e.target as HTMLInputElement).checked })} />
          <label for="branding">{t.posterBrandingLabel}</label>
          {overlay.brandingEnabled && (
            <input type="text" class="jr-poster-settings__text-input"
              value={overlay.brandingText} maxLength={200}
              onInput={e => updateOverlay({ brandingText: (e.target as HTMLInputElement).value })} />
          )}
        </div>
        {overlay.brandingEnabled && (
          <div class="jr-poster-settings__sub-checks">
            <label class="jr-poster-settings__label" style="margin-bottom:0.3rem">{t.posterBrandingFont}</label>
            <div class="jr-poster-settings__font-group">
              {brandFontOptions.map(f => (
                <button
                  key={f.value}
                  class={`jr-poster-settings__font-btn${overlay.brandingFontFamily === f.value ? ' jr-poster-settings__font-btn--active' : ''}`}
                  onClick={() => updateOverlay({ brandingFontFamily: f.value })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Video info */}
        <div class="jr-poster-settings__check-row">
          <input type="checkbox" id="videoInfo" checked={overlay.videoInfoEnabled}
            onChange={e => updateOverlay({ videoInfoEnabled: (e.target as HTMLInputElement).checked })} />
          <label for="videoInfo">{t.posterVideoInfo}</label>
        </div>
        {overlay.videoInfoEnabled && (
          <div class="jr-poster-settings__sub-checks">
            {([
              ['showFileSize', 'posterFileSize'],
              ['showResolutionFps', 'posterResolutionFps'],
              ['showVideoEncoding', 'posterVideoEncoding'],
              ['showAudioEncoding', 'posterAudioEncoding'],
              ['showDuration', 'posterDuration'],
            ] as [keyof OverlaySettingsDto, keyof typeof t][]).map(([key, labelKey]) => (
              <div key={key} class="jr-poster-settings__check-row">
                <input type="checkbox" id={key} checked={overlay[key] as boolean}
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

      {/* Font family — toggle buttons */}
      <div class="jr-poster-settings__section">
        <label class="jr-poster-settings__label">{t.posterFont}</label>
        <div class="jr-poster-settings__font-group">
          {FONTS.map(f => (
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

      {/* Preview — always visible */}
      <div class="jr-poster-settings__section">
        <button class="jr-poster-settings__preview-btn" onClick={handlePreview} disabled={previewLoading}>
          {previewLoading ? t.posterPreviewLoading : t.posterPreview}
        </button>
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
