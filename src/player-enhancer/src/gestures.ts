import { showRipple, showValueOsd } from './osd-overlay';
import type { PlaybackManager } from './types/jellyfin';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

type Zone = 'left' | 'center' | 'right';
interface TapState { time: number; zone: Zone }
interface SwipeState {
  active: boolean;
  startX: number;
  startY: number;
  side: 'left' | 'right';
  startValue: number;
  /** null = 尚未判定方向，'vertical' = 纵向锁定，'horizontal' = 横向忽略 */
  directionLock: 'vertical' | 'horizontal' | null;
}

export function initGestures(
  videoEl: HTMLVideoElement,
  playbackManager: PlaybackManager
): void {
  if (navigator.maxTouchPoints <= 0) return;

  let lastTap: TapState = { time: 0, zone: 'center' };
  const swipe: SwipeState = { active: false, startX: 0, startY: 0, side: 'left', startValue: 1, directionLock: null };

  const container = videoEl.closest('.videoPlayerContainer') ?? document.body;

  // ── Double-tap gesture (capture phase to intercept Jellyfin's tap handler) ──
  container.addEventListener('touchend', (e: TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch) return;

    const now = Date.now();
    const x = touch.clientX;
    const W = window.innerWidth;
    const zone: Zone = x < W / 3 ? 'left' : x < (W * 2) / 3 ? 'center' : 'right';

    if (now - lastTap.time < 300 && zone === lastTap.zone) {
      e.stopPropagation();
      e.preventDefault();

      if (zone === 'left') {
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
        showRipple('left', '-10s');
      } else if (zone === 'right') {
        videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 10);
        showRipple('right', '+10s');
      } else {
        if (videoEl.paused) videoEl.play().catch(() => {});
        else videoEl.pause();
      }

      lastTap = { time: 0, zone: 'center' }; // reset after double-tap consumed
    } else {
      lastTap = { time: now, zone };
    }
  }, { capture: true, passive: false });

  // ── Swipe brightness / volume (passive: false to allow preventDefault) ──
  container.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const side = touch.clientX < window.innerWidth / 2 ? 'left' : 'right';

    swipe.active = true;
    swipe.startX = touch.clientX;
    swipe.startY = touch.clientY;
    swipe.side = side;
    swipe.directionLock = null;
    swipe.startValue = side === 'left'
      ? parseFloat(videoEl.style.filter.replace('brightness(', '').replace(')', '') || '1')
      : videoEl.volume;
  }, { passive: true });

  container.addEventListener('touchmove', (e: TouchEvent) => {
    if (!swipe.active || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - swipe.startX);
    const dy = Math.abs(touch.clientY - swipe.startY);

    // 移动超过 10px 后判定方向，横向移动占优则忽略此次滑动
    if (swipe.directionLock === null && (dx > 10 || dy > 10)) {
      swipe.directionLock = dy >= dx ? 'vertical' : 'horizontal';
    }
    if (swipe.directionLock !== 'vertical') return;

    const deltaY = swipe.startY - touch.clientY;
    const delta = deltaY / (window.innerHeight * 0.5);

    if (swipe.side === 'left') {
      const brightness = clamp(swipe.startValue + delta, 0, 2.0);
      videoEl.style.filter = `brightness(${brightness})`;
      showValueOsd('brightness', brightness * 100);
    } else {
      const volume = clamp(swipe.startValue + delta, 0, 1);
      videoEl.volume = volume;
      showValueOsd('volume', volume * 100);
    }

    e.preventDefault();
  }, { passive: false });

  container.addEventListener('touchend', () => {
    swipe.active = false;
  }, { passive: true });

  void playbackManager; // referenced to avoid unused-param warning
}
