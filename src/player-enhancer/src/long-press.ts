import { t } from './i18n';

const LONG_PRESS_MS   = 500;
const DIR_SAMPLE_PX   = 16;
const HORIZ_DEG       = 20;
const BOTTOM_FRACTION = 1 / 3;

let _active = false;
let _abortCtrl: AbortController | null = null;
let _osdEl: HTMLDivElement | null = null;
let _lastOsdHtml = '';

export function isInLongPressZone(touch: Touch, video: HTMLVideoElement): boolean {
  const r = video.getBoundingClientRect();
  return touch.clientY >= r.top + r.height * (1 - BOTTOM_FRACTION);
}

/**
 * @param video      - current video element
 * @param getRate    - returns configured speedRate (e.g. 2.0)
 * @param onVertical - called when direction is determined to be vertical;
 *                     lets gestures.ts take over brightness/volume swipe
 */
export function initLongPress(
  video: HTMLVideoElement,
  getRate: () => number,
  onVertical: (touch: Touch) => void,
): void {
  if (navigator.maxTouchPoints <= 0) return;
  _abortCtrl?.abort();
  _abortCtrl = new AbortController();
  const sig = _abortCtrl.signal;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0, startY = 0, lastX = 0, lastY = 0;
  let seekOffset = 0;
  let wasPaused = false;

  function enter(): void {
    _active = true;
    wasPaused = video.paused;
    if (video.paused) video.play().catch(() => {});
    video.playbackRate = getRate();
    try { navigator.vibrate(30); } catch { /* no vibration API */ }
    updateOsd(0);
  }

  function exit(): void {
    _active = false;
    video.playbackRate = 1;
    if (wasPaused) video.pause();
    if (seekOffset !== 0) {
      const dur = isFinite(video.duration) ? video.duration : video.currentTime;
      video.currentTime = Math.max(0, Math.min(dur, video.currentTime + seekOffset));
    }
    seekOffset = 0;
    hideOsd();
  }

  function updateOsd(offsetSec: number): void {
    const osd = ensureOsd();
    const rate = getRate();
    const rateTxt = rate % 1 === 0 ? `${rate}` : rate.toFixed(2);
    const line1 = t('longpress.speeding').replace('{rate}', rateTxt);

    let line2: string;
    if (Math.abs(offsetSec) < 0.05) {
      line2 = t('longpress.seekHint');
    } else {
      const sign = offsetSec >= 0 ? '+' : '−';
      const dur = isFinite(video.duration) ? video.duration : video.currentTime;
      const target = Math.max(0, Math.min(dur, video.currentTime + offsetSec));
      line2 = `${sign}${formatOffset(Math.abs(offsetSec))}  →  ${formatTimestamp(target)}`;
    }

    const html = `<div class="jfs-speed-osd__line1">▶▶ ${line1}</div>`
               + `<div class="jfs-speed-osd__line2">${line2}</div>`;
    if (html === _lastOsdHtml) return;
    _lastOsdHtml = html;
    osd.innerHTML = html;
    osd.style.opacity = '1';
  }

  // ── touchstart: own the bottom-1/3 zone ──────────────────────────────────
  document.body.addEventListener('touchstart', (e: TouchEvent) => {
    if (!video.isConnected || e.touches.length !== 1) return;
    const t0 = e.touches[0];
    if (!isInLongPressZone(t0, video)) return;
    startX = lastX = t0.clientX;
    startY = lastY = t0.clientY;
    seekOffset = 0;
    timer = setTimeout(enter, LONG_PRESS_MS);
  }, { passive: true, signal: sig });

  // multi-finger abort
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
      // WAITING: watch for direction to decide if we hand off or cancel
      if (!timer) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DIR_SAMPLE_PX) return;
      clearTimeout(timer); timer = null;
      const deg = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
      if (deg >= HORIZ_DEG) {
        // Vertical: hand ownership to brightness/volume swipe
        onVertical(touch);
      }
      // Horizontal: cancel quietly — no existing gesture handles bottom-1/3 horizontal
      return;
    }

    // SPEEDING: per-frame direction → dynamic rate + seek accumulation
    const deltaX = touch.clientX - lastX;
    const deltaY = touch.clientY - lastY;
    lastX = touch.clientX;
    lastY = touch.clientY;
    const moveDist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (moveDist > 2) {
      const deg = Math.atan2(Math.abs(deltaY), Math.abs(deltaX)) * 180 / Math.PI;
      if (deg < HORIZ_DEG) {
        // Horizontal seek: slow to 1× so user can hear content while positioning
        video.playbackRate = 1;
        const dur = isFinite(video.duration) ? video.duration : 0;
        const sPerVw = Math.max(0.1, Math.min(10, dur * 0.001));
        seekOffset += (deltaX / window.innerWidth * 100) * sPerVw;
        updateOsd(seekOffset);
      } else {
        // Vertical: resume speed, ignore movement (don't touch brightness/volume)
        video.playbackRate = getRate();
      }
    }
  }, { passive: true, signal: sig });

  // ── touchend / touchcancel ─────────────────────────────────────────────────
  const onEnd = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (_active) exit();
  };
  document.body.addEventListener('touchend',    onEnd, { passive: true, signal: sig });
  document.body.addEventListener('touchcancel', onEnd, { passive: true, signal: sig });

  void startY; // suppress unused-var warning — used in direction math above
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
  if (_osdEl) { _osdEl.style.opacity = '0'; _lastOsdHtml = ''; }
}

function formatOffset(abs: number): string {
  return abs >= 60
    ? `${Math.floor(abs / 60)}m ${(abs % 60).toFixed(1)}s`
    : `${abs.toFixed(1)}s`;
}

function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
