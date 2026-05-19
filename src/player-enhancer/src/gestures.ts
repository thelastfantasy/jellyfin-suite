import { showRipple, showValueOsd } from './osd-overlay';

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

/** 判断触摸是否落在 OSD 控件上（按钮/滑块/标签），避免误触发手势 */
function isOsdControl(target: EventTarget | null): boolean {
  let el = target as Element | null;
  while (el && el !== document.body) {
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'LABEL') return true;
    if (el.classList.contains('osdControls')) return true;
    if (el.classList.contains('sliderContainer')) return true;
    // 我们自己注入的控件区域（Firefox 有时报告不同的 target，通过 ancestor 兜底）
    if (el.classList.contains('jfs-enhancer-screenshot-wrap')) return true;
    if (el.classList.contains('jfs-enhancer-framestep-wrap')) return true;
    el = el.parentElement;
  }
  return false;
}

let _seekSeconds = 10;
/** 最近一次我们处理双击的时间戳，用于阻止 Firefox 同时触发的 dblclick 事件 */
let _lastDoubleTapMs = 0;

export function setSeekSeconds(s: number): void {
  _seekSeconds = s;
}

// Firefox 在 touchend.preventDefault() 后仍会触发 dblclick（与 Chrome 不同）
// 在 document 上 capture 拦截，确保我们处理过的双击不再冒泡到 Jellyfin 的全屏处理器
document.addEventListener('dblclick', (e: MouseEvent) => {
  if (Date.now() - _lastDoubleTapMs < 600) {
    e.stopPropagation();
    e.preventDefault();
  }
}, { capture: true });

export function initGestures(videoEl: HTMLVideoElement): void {
  if (navigator.maxTouchPoints <= 0) return;

  let lastTap: TapState = { time: 0, zone: 'center' };
  const swipe: SwipeState = { active: false, startX: 0, startY: 0, side: 'left', startValue: 1, directionLock: null };

  // 监听 document.body：videoPlayerContainer 在 OSD overlay 之后，
  // 用户触摸屏幕时事件目标是 OSD 页面元素，必须在更高层捕获
  const container = document.body;

  // ── Double-tap gesture (capture phase to intercept Jellyfin's tap handler) ──
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
      e.stopPropagation();
      e.preventDefault();
      _lastDoubleTapMs = Date.now(); // 告知 dblclick 拦截器本次双击已由我们处理

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

  // ── Swipe brightness / volume (passive: false to allow preventDefault) ──
  container.addEventListener('touchstart', (e: TouchEvent) => {
    if (!videoEl.isConnected) return;
    if (e.touches.length !== 1) return;
    if (isOsdControl(e.target)) return;

    const touch = e.touches[0];
    const side = touch.clientX < window.innerWidth / 2 ? 'left' : 'right';

    // Jellyfin 以立方根缩放显示音量，startValue 记录当前线性音量
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
    if (!videoEl.isConnected || !swipe.active || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - swipe.startX);
    const dy = Math.abs(touch.clientY - swipe.startY);

    if (swipe.directionLock === null && (dx > 10 || dy > 10)) {
      swipe.directionLock = dy >= dx ? 'vertical' : 'horizontal';
      // 确定为右侧纵向滑动时压制 Jellyfin 原生音量 OSD
      if (swipe.directionLock === 'vertical' && swipe.side === 'right') {
        document.body.classList.add('jfs-volume-swiping');
      }
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
      // 显示与 Jellyfin 音量条一致的立方根百分比
      showValueOsd('volume', Math.pow(volume, 1 / 3) * 100);
    }

    e.preventDefault();
  }, { passive: false });

  container.addEventListener('touchend', () => {
    swipe.active = false;
    document.body.classList.remove('jfs-volume-swiping');
  }, { passive: true });

}
