import { showRipple, showValueOsd } from './osd-overlay';
import { cancelPendingLongPress, isLongPressActive } from './long-press';
import { showTrickplayThumb, hideTrickplayThumb, prefetchFrame } from './trickplay';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

type Zone = 'left' | 'center' | 'right';
interface TapState { time: number; zone: Zone }

type GestureMode = 'idle' | 'pending' | 'seek' | 'swipe';

interface GestureState {
  mode: GestureMode;
  startX: number;
  startY: number;
  lastX: number;
  lastMoveTime: number;
  // seek state
  seekAnchorSec: number;
  seekOffsetSec: number;
  // swipe state
  swipeSide: 'left' | 'right';
  swipeStartValue: number;
}

let _seekOsdEl: HTMLDivElement | null = null;
let _seekOsdHideTimer: ReturnType<typeof setTimeout> | null = null;

let _seekSeconds = 10;

export function setSeekSeconds(s: number): void {
  _seekSeconds = s;
}

function ensureSeekOsd(): HTMLDivElement {
  if (!_seekOsdEl) {
    _seekOsdEl = document.createElement('div');
    _seekOsdEl.className = 'jfs-seek-osd';
    document.body.appendChild(_seekOsdEl);
  }
  return _seekOsdEl;
}

function showSeekOsd(offsetSec: number, currentSec: number): void {
  const osd = ensureSeekOsd();
  if (_seekOsdHideTimer) { clearTimeout(_seekOsdHideTimer); _seekOsdHideTimer = null; }
  const sign = offsetSec >= 0 ? '+' : '−';
  const abs = Math.abs(offsetSec);
  const offsetStr = abs >= 60
    ? `${Math.floor(abs / 60)}m ${(abs % 60).toFixed(1)}s`
    : `${abs.toFixed(1)}s`;
  const h = Math.floor(currentSec / 3600);
  const m = Math.floor((currentSec % 3600) / 60);
  const s = Math.floor(currentSec % 60);
  const ts = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  osd.innerHTML = `<div class="jfs-seek-osd__line1">${sign}${offsetStr}  →  ${ts}</div>`;
  osd.style.opacity = '1';
}

function hideSeekOsd(delayMs = 0): void {
  if (!_seekOsdEl) return;
  if (_seekOsdHideTimer) clearTimeout(_seekOsdHideTimer);
  if (delayMs <= 0) {
    _seekOsdEl.style.opacity = '0';
    hideTrickplayThumb();
    _seekOsdHideTimer = null;
  } else {
    _seekOsdHideTimer = setTimeout(() => {
      if (_seekOsdEl) _seekOsdEl.style.opacity = '0';
      hideTrickplayThumb();
      _seekOsdHideTimer = null;
    }, delayMs);
  }
}

/** 判断触摸是否落在 OSD 控件上，避免误触发手势 */
function isOsdControl(target: EventTarget | null): boolean {
  let el = target as Element | null;
  while (el && el !== document.body) {
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'LABEL') return true;
    if (el.classList.contains('osdControls')) return true;
    if (el.classList.contains('sliderContainer')) return true;
    if (el.classList.contains('jfs-enhancer-screenshot-wrap')) return true;
    if (el.classList.contains('jfs-enhancer-framestep-wrap')) return true;
    el = el.parentElement;
  }
  return false;
}

// Suppress Jellyfin's dblclick handler (fullscreen toggle) on touch devices.
if (navigator.maxTouchPoints > 0) {
  document.addEventListener('dblclick', (e: Event) => {
    e.stopImmediatePropagation();
    e.preventDefault();
  }, { capture: true });
}

export function initGestures(videoEl: HTMLVideoElement, getItemId: () => string): void {
  if (navigator.maxTouchPoints <= 0) return;

  let lastTap: TapState = { time: 0, zone: 'center' };
  const gs: GestureState = {
    mode: 'idle',
    startX: 0, startY: 0, lastX: 0, lastMoveTime: 0,
    seekAnchorSec: 0, seekOffsetSec: 0,
    swipeSide: 'left', swipeStartValue: 1,
  };

  const container = document.body;

  // ── Double-tap seek (capture phase) ──────────────────────────────────────
  container.addEventListener('touchend', (e: TouchEvent) => {
    if (!videoEl.isConnected) return;
    if (isOsdControl(e.target)) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const now = Date.now();
    const x = touch.clientX;
    const W = window.innerWidth;
    const zone: Zone = x < W / 3 ? 'left' : x < (W * 2) / 3 ? 'center' : 'right';

    if (now - lastTap.time < 300 && zone === lastTap.zone) {
      e.stopImmediatePropagation();
      e.preventDefault();
      cancelPendingLongPress();
      if (zone === 'left') {
        videoEl.currentTime = Math.max(0, videoEl.currentTime - _seekSeconds);
        showRipple('left', `-${_seekSeconds}s`);
      } else if (zone === 'right') {
        videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + _seekSeconds);
        showRipple('right', `+${_seekSeconds}s`);
      } else {
        if (videoEl.paused) videoEl.play().catch(() => {});
        else videoEl.pause();
      }
      lastTap = { time: 0, zone: 'center' };
    } else {
      lastTap = { time: now, zone };
    }
  }, { capture: true, passive: false });

  // ── Unified touch state machine ───────────────────────────────────────────
  container.addEventListener('touchstart', (e: TouchEvent) => {
    if (!videoEl.isConnected) return;
    if (e.touches.length !== 1) { gs.mode = 'idle'; return; }
    if (isOsdControl(e.target)) { gs.mode = 'idle'; return; }
    const touch = e.touches[0];
    // Exclude Android pull-down notification zone
    if (touch.clientY < window.innerHeight * 0.10) { gs.mode = 'idle'; return; }

    gs.mode = 'pending';
    gs.startX = gs.lastX = touch.clientX;
    gs.startY = touch.clientY;
    gs.lastMoveTime = Date.now();
    gs.seekAnchorSec = videoEl.currentTime;
    gs.seekOffsetSec = 0;
    gs.swipeSide = touch.clientX < window.innerWidth / 2 ? 'left' : 'right';
    gs.swipeStartValue = gs.swipeSide === 'left'
      ? parseFloat(videoEl.style.filter.replace('brightness(', '').replace(')', '') || '1')
      : videoEl.volume;
  }, { passive: true });

  container.addEventListener('touchmove', (e: TouchEvent) => {
    if (!videoEl.isConnected || gs.mode === 'idle') return;
    if (e.touches.length !== 1) { gs.mode = 'idle'; return; }
    const touch = e.touches[0];

    if (gs.mode === 'pending') {
      const dx = touch.clientX - gs.startX;
      const dy = touch.clientY - gs.startY;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      const deg = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
      if (deg < 30) {
        // Horizontal: seek drag (not during long-press speed mode)
        if (isLongPressActive()) { gs.mode = 'idle'; return; }
        gs.mode = 'seek';
        cancelPendingLongPress();
        document.body.classList.add('jfs-seeking');
      } else {
        gs.mode = 'swipe';
      }
    }

    if (gs.mode === 'seek') {
      const deltaX = touch.clientX - gs.lastX;
      gs.lastX = touch.clientX;
      const now = Date.now();
      const dt = (now - gs.lastMoveTime) || 1;
      gs.lastMoveTime = now;

      const dur = isFinite(videoEl.duration) ? videoEl.duration : 0;
      const sPerVw = Math.max(0.1, Math.min(10, dur * 0.001));
      gs.seekOffsetSec += (deltaX / window.innerWidth * 100) * sPerVw;
      // Don't touch videoEl.currentTime here — commit on touchend
      const targetSec = Math.max(0, Math.min(dur, gs.seekAnchorSec + gs.seekOffsetSec));

      showSeekOsd(gs.seekOffsetSec, targetSec);

      const velPxPerMs = Math.abs(deltaX) / dt;
      const dir = deltaX > 0 ? 1 : -1;
      const targetMs = targetSec * 1000;
      const itemId = getItemId();
      if (velPxPerMs < 8) {
        prefetchFrame(targetMs - 500, itemId);
        prefetchFrame(targetMs,       itemId);
        prefetchFrame(targetMs + 500, itemId);
      } else {
        prefetchFrame(targetMs + dir * 1000, itemId);
        prefetchFrame(targetMs + dir * 2000, itemId);
        prefetchFrame(targetMs + dir * 4000, itemId);
      }
      showTrickplayThumb(targetMs, itemId, videoEl);
      return;
    }

    if (gs.mode === 'swipe') {
      const deltaY = gs.startY - touch.clientY;
      const delta = deltaY / (window.innerHeight * 0.5);
      if (gs.swipeSide === 'left') {
        const brightness = clamp(gs.swipeStartValue + delta, 0, 2.0);
        videoEl.style.filter = `brightness(${brightness})`;
        showValueOsd('brightness', brightness * 100);
      } else {
        const volume = clamp(gs.swipeStartValue + delta, 0, 1);
        videoEl.volume = volume;
        showValueOsd('volume', Math.pow(volume, 1 / 3) * 100);
      }
      e.preventDefault();
    }
  }, { passive: false });

  const onEnd = (): void => {
    if (gs.mode === 'seek') {
      // Commit the seek on finger lift
      const dur = isFinite(videoEl.duration) ? videoEl.duration : 0;
      videoEl.currentTime = Math.max(0, Math.min(dur, gs.seekAnchorSec + gs.seekOffsetSec));
      hideSeekOsd(800);
      document.body.classList.remove('jfs-seeking');
    }
    gs.mode = 'idle';
  };
  container.addEventListener('touchend',    onEnd, { passive: true });
  container.addEventListener('touchcancel', onEnd, { passive: true });
}
