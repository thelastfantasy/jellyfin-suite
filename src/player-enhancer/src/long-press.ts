import { t } from './i18n';

const LONG_PRESS_MS   = 500;
const DIR_SAMPLE_PX   = 12;
const BOTTOM_FRACTION = 1 / 3;

let _active = false;
let _suppressContextMenuUntil = 0;
let _abortCtrl: AbortController | null = null;
let _osdEl: HTMLDivElement | null = null;
let _lastOsdHtml = '';
let _cancelPending: (() => void) | null = null;

export function cancelPendingLongPress(): void {
  _cancelPending?.();
}

export function isLongPressActive(): boolean {
  return _active;
}

export function isInLongPressZone(touch: Touch, video: HTMLVideoElement): boolean {
  const r = video.getBoundingClientRect();
  return touch.clientY >= r.top + r.height * (1 - BOTTOM_FRACTION);
}

export function initLongPress(
  video: HTMLVideoElement,
  getRate: () => number,
): void {
  if (navigator.maxTouchPoints <= 0) return;
  _abortCtrl?.abort();
  _abortCtrl = new AbortController();
  const sig = _abortCtrl.signal;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0, startY = 0;
  let wasPaused = false;

  function enter(): void {
    _active = true;
    wasPaused = video.paused;
    if (video.paused) video.play().catch(() => {});
    video.playbackRate = getRate();
    try { navigator.vibrate(30); } catch { /* no vibration API */ }
    updateOsd();
  }

  function exit(): void {
    _active = false;
    _suppressContextMenuUntil = Date.now() + 800;
    video.playbackRate = 1;
    if (wasPaused) video.pause();
    hideOsd();
  }

  function updateOsd(): void {
    const osd = ensureOsd();
    const rate = getRate();
    const rateTxt = rate % 1 === 0 ? `${rate}` : rate.toFixed(2);
    const html = `<div class="jfs-speed-osd__line1">▶▶ ${t('longpress.speeding').replace('{rate}', rateTxt)}</div>`;
    if (html === _lastOsdHtml) return;
    _lastOsdHtml = html;
    osd.innerHTML = html;
    osd.style.opacity = '1';
  }

  // ── touchstart: own the bottom-1/3 zone ──────────────────────────────────
  document.body.addEventListener('touchstart', (e: TouchEvent) => {
    if (!video.isConnected || e.touches.length !== 1) return;
    if (video.paused) return;
    const t0 = e.touches[0];
    if (!isInLongPressZone(t0, video)) return;
    startX = t0.clientX;
    startY = t0.clientY;
    timer = setTimeout(enter, LONG_PRESS_MS);
    _cancelPending = () => { if (timer) { clearTimeout(timer); timer = null; } };
  }, { passive: true, signal: sig });

  document.addEventListener('contextmenu', (e: Event) => {
    if (!video.paused || Date.now() < _suppressContextMenuUntil) e.preventDefault();
  }, { capture: true, signal: sig });

  document.body.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length > 1 && (_active || timer !== null)) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (_active) exit();
    }
  }, { passive: true, signal: sig });

  // ── touchmove ─────────────────────────────────────────────────────────────
  document.body.addEventListener('touchmove', (e: TouchEvent) => {
    if (!video.isConnected) return;
    const touch = e.touches[0];
    if (!touch) return;

    if (!_active) {
      if (!timer) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) < DIR_SAMPLE_PX) return;
      // Any movement while timer pending → cancel; gestures.ts handles the actual gesture
      clearTimeout(timer); timer = null;
      return;
    }

    // SPEEDING: speed is already set; gestures.ts handles seek drag independently
    updateOsd();
  }, { passive: true, signal: sig });

  // ── touchend / touchcancel ─────────────────────────────────────────────────
  const onEnd = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (_active) exit();
  };
  document.body.addEventListener('touchend',    onEnd, { passive: true, signal: sig });
  document.body.addEventListener('touchcancel', onEnd, { passive: true, signal: sig });
}

// ── OSD helpers ──────────────────────────────────────────────────────────────

function ensureOsd(): HTMLDivElement {
  if (!_osdEl) {
    _osdEl = document.createElement('div');
    _osdEl.className = 'jfs-speed-osd';
    document.body.appendChild(_osdEl);
  }
  return _osdEl;
}

function hideOsd(): void {
  if (_osdEl) {
    _osdEl.style.opacity = '0';
    _lastOsdHtml = '';
  }
}
