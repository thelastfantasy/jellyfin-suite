# Implementation Plan: Long-Press Speed + Seek

**Feature**: 007-long-press-speed-seek
**Branch**: `feat/long-press-speed-seek`

## File Map

```
src/player-enhancer/src/
  long-press.ts                         ← 新增：长按手势核心逻辑
  gestures.ts                           ← 修改：感知 long-press 激活状态，屏蔽纵向手势冲突
  styles.ts                             ← 修改：新增 .jfs-speed-osd 样式
  i18n.ts                               ← 修改：新增 longpress.* key
  injector.ts                           ← 修改：调用 initLongPress()

src/JellyfinSuite.Plugin/Controllers/
  PlayerEnhancerController.cs           ← 修改：GestureConfigDto 增加 SpeedRate 字段

src/frontend/src/components/
  PlayerEnhancerPanel.tsx               ← 修改：管理面板新增"长按加速倍率"配置项

src/frontend/src/api/
  jellyfinClient.ts 或对应 API 文件     ← 修改：GestureConfig 类型增加 speedRate
```

## Direction Detection

采用**角度阈值法**，等累积位移 ≥ 16px 后再判定，避免样本不足时误判：

```typescript
const dist = Math.sqrt(dx * dx + dy * dy);
if (dist < 16) return; // 等待更多位移

const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
// angle: 0° = 纯横向, 90° = 纯纵向
const isHorizontal = angle < 30;
```

- `angle < 30°` → 横向：取消定时器，不触发亮度/音量手势
- `angle ≥ 30°` → 纵向：取消定时器，**交还**给 `gestures.ts` 的滑动手势正常处理

## Seek Sensitivity

```typescript
const secondsPerVw = Math.max(0.1, Math.min(10, video.duration * 0.001));
const deltaVw = deltaX / window.innerWidth * 100;
seekOffset += deltaVw * secondsPerVw;
```

单位为 vw，跨设备 DPI 无关。精度下限 0.1 s/vw，上限 10 s/vw。

## long-press.ts

```typescript
import { t } from './i18n';

const LONG_PRESS_MS = 500;
const DIR_THRESHOLD_PX = 16;
const BOTTOM_FRACTION = 1 / 3;

let _active = false;
export function isLongPressActive(): boolean { return _active; }

export function initLongPress(videoEl: HTMLVideoElement, getSpeedRate: () => number): void {
  if (navigator.maxTouchPoints <= 0) return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0, startY = 0;
  let totalSeekOffset = 0;
  let lastX = 0;
  let dirLocked = false;

  function getVideoBottomThird(): { top: number; bottom: number } {
    const r = videoEl.getBoundingClientRect();
    return { top: r.top + r.height * BOTTOM_FRACTION * 2, bottom: r.bottom };
  }

  function showSpeedOsd(offset: number): void { /* 见 OSD 实现 */ }
  function hideSpeedOsd(): void { /* 见 OSD 实现 */ }

  function enter(): void {
    _active = true;
    const rate = getSpeedRate();
    videoEl.playbackRate = rate;
    try { navigator.vibrate(30); } catch {}
    showSpeedOsd(0);
  }

  function exit(): void {
    _active = false;
    videoEl.playbackRate = 1;
    if (totalSeekOffset !== 0) {
      videoEl.currentTime = Math.max(0, Math.min(
        videoEl.duration || 0,
        videoEl.currentTime + totalSeekOffset
      ));
    }
    hideSpeedOsd();
    totalSeekOffset = 0;
    dirLocked = false;
  }

  function cancel(): void {
    if (timer) { clearTimeout(timer); timer = null; }
    if (_active) exit();
    else { totalSeekOffset = 0; dirLocked = false; }
  }

  document.body.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    if (!videoEl.isConnected) return;
    const touch = e.touches[0];
    const zone = getVideoBottomThird();
    if (touch.clientY < zone.top || touch.clientY > zone.bottom) return;
    // 不检查 isOsdControl：底部 1/3 区域 OSD 控件已在更上方

    startX = lastX = touch.clientX;
    startY = touch.clientY;
    totalSeekOffset = 0;
    dirLocked = false;
    timer = setTimeout(enter, LONG_PRESS_MS);
  }, { passive: true });

  document.body.addEventListener('touchmove', (e: TouchEvent) => {
    if (!videoEl.isConnected) return;
    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!_active && timer) {
      // 等待期：检测方向，决定是否取消定时器
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= DIR_THRESHOLD_PX) {
        const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
        // 无论横向还是纵向，都取消长按定时器
        clearTimeout(timer); timer = null;
        // 纵向：交还给 gestures.ts 的亮度/音量逻辑（不做任何事，它自己会处理）
        // 横向：无既有手势，直接忽略
        _ = angle; // suppress unused warning
      }
      return;
    }

    if (!_active) return;

    // 加速模式：只处理横向
    const deltaX = touch.clientX - lastX;
    lastX = touch.clientX;
    const deltaVw = deltaX / window.innerWidth * 100;
    const secondsPerVw = Math.max(0.1, Math.min(10, (videoEl.duration || 0) * 0.001));
    totalSeekOffset += deltaVw * secondsPerVw;
    showSpeedOsd(totalSeekOffset);
  }, { passive: true });

  function onEnd(): void {
    if (timer) { clearTimeout(timer); timer = null; }
    if (_active) exit();
  }

  document.body.addEventListener('touchend', onEnd, { passive: true });
  document.body.addEventListener('touchcancel', onEnd, { passive: true });

  // 多指中止
  document.body.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length > 1 && _active) exit();
  }, { passive: true });
}
```

## gestures.ts 修改

在 `touchmove` 的纵向分支开头加守卫：

```typescript
import { isLongPressActive } from './long-press';

// touchmove handler 内，directionLock === 'vertical' 分支：
if (swipe.directionLock !== 'vertical') return;
if (isLongPressActive()) return; // ← 新增：加速模式优先
```

## OSD 实现（long-press.ts 内）

```typescript
let _osdEl: HTMLDivElement | null = null;

function ensureOsd(): HTMLDivElement {
  if (_osdEl) return _osdEl;
  _osdEl = document.createElement('div');
  _osdEl.className = 'jfs-speed-osd';
  document.body.appendChild(_osdEl);
  return _osdEl;
}

function showSpeedOsd(offsetSec: number): void {
  const osd = ensureOsd();
  const rate = videoEl.playbackRate;
  const line1 = t('longpress.speeding').replace('{rate}', rate.toFixed(2).replace(/\.?0+$/, ''));
  const abs = Math.abs(offsetSec);
  let line2: string;
  if (Math.abs(offsetSec) < 0.05) {
    line2 = t('longpress.seekHint');
  } else {
    const sign = offsetSec >= 0 ? '+' : '−';
    line2 = abs >= 60
      ? `${sign}${Math.floor(abs / 60)}m ${(abs % 60).toFixed(1)}s`
      : `${sign}${abs.toFixed(1)}s`;
  }
  osd.innerHTML = `<div class="jfs-speed-osd__line1">${line1}</div>
                   <div class="jfs-speed-osd__line2">${line2}</div>`;
  osd.style.opacity = '1';
}

function hideSpeedOsd(): void {
  if (_osdEl) _osdEl.style.opacity = '0';
}
```

## styles.ts 新增

```css
.jfs-speed-osd {
  position: fixed;
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border-radius: 12px;
  padding: 12px 20px;
  text-align: center;
  pointer-events: none;
  z-index: 99999;
  transition: opacity 0.25s;
  opacity: 0;
  white-space: nowrap;
}

.jfs-speed-osd__line1 {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.jfs-speed-osd__line2 {
  font-size: 14px;
  opacity: 0.8;
  margin-top: 4px;
  line-height: 1.3;
}
```

## Backend: GestureConfigDto 扩展

```csharp
[JsonPropertyName("speedRate")]
public double SpeedRate { get; set; } = 2.0;
```

Controller 的 `GetGestureConfig` 读取，`SaveGestureConfig` 写入，复用现有 `config.json` 机制。

## Frontend: PlayerEnhancerPanel.tsx

在"Double-tap seek"配置行下方新增：

```tsx
<label>{t.enhancerSpeedLabel}</label>
<input type="number" min={1.25} max={4} step={0.25}
       value={speedRate}
       onChange={e => setSpeedRate(parseFloat(e.currentTarget.value))} />
<span>{t.enhancerSpeedUnit}</span>  {/* "x" */}
```

对应新增前端 i18n key：`enhancerSpeedLabel`、`enhancerSpeedUnit`。

## Integration in injector.ts

```typescript
import { initLongPress } from './long-press';

// 在 injectPlayerButtons 末尾或 _currentVideoEl 更新处：
initLongPress(videoEl, () => _speedRate);  // _speedRate 从 loadGestureConfig 更新
```

`loadGestureConfig()` 解析 `cfg.speedRate` 并存入模块级变量 `_speedRate`（与现有 `_seekSeconds` 同模式）。
