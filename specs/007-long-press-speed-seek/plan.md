# Implementation Plan: Long-Press Speed + Seek

**Feature**: 007-long-press-speed-seek
**Branch**: `feat/long-press-speed-seek`

---

## File Map

```
src/player-enhancer/src/
  long-press.ts          ← 新增：长按手势核心逻辑
  gestures.ts            ← 修改：感知 long-press 激活状态，屏蔽纵向手势冲突
  styles.ts              ← 修改：新增 .jfs-speed-osd 样式
  i18n.ts                ← 修改：新增 longpress.* key
  injector.ts            ← 修改：调用 initLongPress()，读取 speedRate 配置

src/JellyfinSuite.Plugin/Controllers/
  PlayerEnhancerController.cs   ← 修改：GestureConfigDto 增加 SpeedRate 字段

src/frontend/src/components/
  PlayerEnhancerPanel.tsx       ← 修改：管理面板新增"长按加速倍率"配置项

src/frontend/src/api/（对应类型文件）
                                ← 修改：GestureConfig 类型增加 speedRate
```

---

## 1. 方向判定算法（WAITING 阶段详解）

### 为什么要等累积 ≥ 16px

- 人手在触屏落点时有自然抖动（约 ±2-4px CSS），立即判定角度噪声过大
- 16px 在 390px 宽手机上约为 4vw ≈ 4mm 物理位移，足以建立稳定方向向量
- 过大（如 30px）会导致方向判定延迟明显，用户感知到"迟钝"
- **实现**：以 `startX/startY`（touchstart 坐标）为原点，每次 touchmove 重新计算累积 `dist`，而非上一帧增量

### 角度阈值选择

```
angle = atan2(|ΔY|, |ΔX|)     ← 0° 为纯横向，90° 为纯纵向
```

人手运动的实测分布（经验值）：
- **故意横滑**：95% 落在 ±15° 以内，极端情况达 ±25°
- **故意纵滑**：95% 落在 ±20° 以内（竖向更难保持直线），极端情况 ±30°

基于此，采用**非对称阈值 + 模糊区统一按纵向处理**：

```
angle < 20°     → 横向：取消定时器，不交还（无既有横向手势）
angle ≥ 20°     → 纵向（含模糊区）：取消定时器，交还给亮度/音量手势
```

选 20° 而非 30° 的理由：
- 宁可在模糊区（20°–45°）保守地归为纵向，交还给滑动手势（它自己有 45° 判定）
- 避免"想调亮度却误触发了长按取消"这一低频但恼人的误操作
- 20° ≈ `tan⁻¹(1/2.75)`，即横向每移动 2.75 单位纵向移动不超过 1 单位，门槛合理

**注意**：一旦取消定时器，`gestures.ts` 的滑动手势会从同一个 `touchstart` 继续处理（它已初始化 `swipe.active = true`），因此无需手动"交还"，只需 long-press 模块不再消费后续事件即可。

### 伪代码

```typescript
const LONG_PRESS_MS = 500;
const DIR_SAMPLE_PX = 16;   // 累积位移阈值
const HORIZ_ANGLE_DEG = 20; // 横向判定上限

// 在 touchmove 内（WAITING 状态）：
const dx = touch.clientX - startX;  // 从 touchstart 原点算
const dy = touch.clientY - startY;
const dist = Math.sqrt(dx * dx + dy * dy);
if (dist < DIR_SAMPLE_PX) return; // 样本不足，继续等待

const angleDeg = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
clearTimeout(timer); timer = null;
// 无论横纵，定时器都取消；纵向时 gestures.ts 自然接管
```

---

## 2. SPEEDING 阶段：Seek 累积

### 不需要角度判定

进入 SPEEDING 后，只取 `ΔX` 分量贡献 seekOffset，`ΔY` 自动被丢弃。无需再做方向检查。

### 增量 vs 累积

使用**增量（incremental）**方式：`deltaX = touch.clientX - lastX`，每帧更新 `lastX`。

- **优点**：用户可以横向画"来回"——先右滑 +30s 再左滑 -10s，最终 +20s。行为直觉上类似实体旋钮
- **注意**：`lastX` 在进入 SPEEDING 时初始化为 `startX`（长按落点），而不是进入加速模式那一帧的坐标

### 灵敏度公式

```typescript
const dur = isFinite(videoEl.duration) ? videoEl.duration : 0;
                                    // ↑ 直播流 duration = Infinity，需特判
const secondsPerVw = Math.max(0.1, Math.min(10, dur * 0.001));
const deltaVw = (touch.clientX - lastX) / window.innerWidth * 100;
seekOffset += deltaVw * secondsPerVw;
lastX = touch.clientX;
```

参考值（50vw = 手机屏幕宽度的一半）：

| 内容类型 | 时长 | s/vw | 50vw 偏移 |
|---------|------|------|----------|
| 电影 | 2h = 7200s | 7.2（capped 10） | 500s ≈ 8min |
| 番剧 | 24min = 1440s | 1.44 | 72s |
| 短片 | 3min = 180s | 0.18 | 9s |
| 超短片 | 30s | 0.10（min） | 5s |

**直播流处理**：`duration = Infinity` 时 `secondsPerVw = 0.1`（最小值），seek 调用可能无效但不报错。

### Seek 边界

```typescript
const targetTime = Math.max(0, Math.min(
  isFinite(videoEl.duration) ? videoEl.duration : videoEl.currentTime,
  videoEl.currentTime + seekOffset
));
```

---

## 3. 退出时的操作顺序

顺序很重要，错误顺序会导致在加速速率下执行 seek：

```
1. videoEl.playbackRate = wasPaused ? 0 : 1   // 先恢复速率（或暂停）
2. if (seekOffset !== 0) videoEl.currentTime = targetTime   // 再 seek
3. OSD 隐藏
4. 重置状态变量
```

**原始暂停状态追踪**：

```typescript
let wasPaused = false;

// enter() 时：
wasPaused = videoEl.paused;
if (videoEl.paused) videoEl.play().catch(() => {});   // 加速时必须播放才有意义
videoEl.playbackRate = speedRate;

// exit() 时：
videoEl.playbackRate = 1;
if (wasPaused) videoEl.pause();   // 还原暂停状态
if (seekOffset !== 0) videoEl.currentTime = targetTime;
```

---

## 4. OSD 设计详解

### 位置

```css
position: fixed;
top: 15%;                         /* 屏幕顶部 15%，不遮挡进度条（底部）和标题（顶端）*/
left: 50%;
transform: translateX(-50%);
```

### 内容三阶段

**阶段 A：刚进入加速，无 seek**
```
▶▶  ×2
← → 调节进度
```

**阶段 B：正在横滑 seek（|offset| ≥ 0.05s）**
```
▶▶  ×2
+ 1m 23.5s   [→ 当前位置 + offset 的绝对时间戳]
```

绝对时间戳（次行右侧，可选）：`→ 01:23:45` 让用户知道会跳到哪里，比纯偏移量更有用：

```typescript
function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// 在 showSpeedOsd(offset) 中：
const target = Math.max(0, Math.min(
  isFinite(videoEl.duration) ? videoEl.duration : videoEl.currentTime,
  videoEl.currentTime + offset
));
const line2 = Math.abs(offset) < 0.05
  ? t('longpress.seekHint')
  : `${offset >= 0 ? '+' : '−'}${formatOffset(Math.abs(offset))}  →  ${formatTimestamp(target)}`;
```

偏移量格式（`formatOffset`）：
- `< 60s`：`"15.3s"`
- `≥ 60s`：`"2m 03.5s"`（保留 0.1s 精度）
- 注意用 `"−"` 而非 `"-"` 表示负数，视觉更清晰

**阶段 C：exit() 后，OSD fade-out**
```css
transition: opacity 0.25s ease-out;
/* opacity: 1 → 0 */
```

### OSD 不应随 seek 抖动

`showSpeedOsd` 在每次 touchmove 触发，频率可能达 60fps。
使用 `innerHTML` 直接赋值在文字不变时会导致不必要的 reflow。
优化：仅在内容变化时更新：

```typescript
let _lastOsdText = '';
function showSpeedOsd(offset: number): void {
  const text = buildOsdHtml(offset);
  if (text === _lastOsdText) return;
  _lastOsdText = text;
  ensureOsd().innerHTML = text;
  ensureOsd().style.opacity = '1';
}
```

---

## 5. 与 gestures.ts 的冲突避免

### WAITING 阶段

`gestures.ts` 的 `touchstart` 正常初始化 `swipe.active = true`，long-press 模块的 `touchstart` 也同时触发（两者都监听 `document.body`）。

在 WAITING 期间：
- 如果方向判定为纵向 → long-press 取消定时器后不再消费事件，gestures.ts 的 `touchmove` 正常接管 ✓
- 如果方向判定为横向 → long-press 取消定时器，gestures.ts 判定方向为 `'horizontal'` 并忽略，结果双方都不处理 ✓（正确：横向无既有手势）

### SPEEDING 阶段

`gestures.ts` 中 `touchmove` 的纵向逻辑需要被屏蔽：

```typescript
// gestures.ts — touchmove handler
if (swipe.directionLock !== 'vertical') return;
if (isLongPressActive()) return;   // ← 新增守卫

// 以下亮度/音量逻辑不再执行
```

这样即使 SPEEDING 时用户有轻微纵向漂移，也不会误调亮度/音量。

### 双击快进的独立性

双击快进（double-tap seek）监听 `touchend`，在 `touchend` 时检查两次 tap 的时间差。
长按场景下，`touchend` 触发时 `lastTap.time` 距 touchstart 已过 ≥500ms，必然不满足 `< 300ms` 的双击条件，因此两者**天然不冲突**，无需额外处理。

---

## 6. 监听器生命周期

`initLongPress` 向 `document.body` 注册的监听器在视频元素切换时（injector.ts 重新调用 `initLongPress`）会重复注册，导致事件处理多次触发。

两种方案：
- **方案 A（推荐）**：用 `AbortController` 管理，切换时 `abort()` 旧的再重新注册
- **方案 B**：模块级单例 flag，只注册一次，`videoEl` 通过闭包更新引用

方案 A 代码结构：

```typescript
let _abortController: AbortController | null = null;

export function initLongPress(videoEl: HTMLVideoElement, getSpeedRate: () => number): void {
  if (navigator.maxTouchPoints <= 0) return;
  _abortController?.abort();
  _abortController = new AbortController();
  const signal = _abortController.signal;

  document.body.addEventListener('touchstart', handler, { passive: true, signal });
  document.body.addEventListener('touchmove', handler, { passive: true, signal });
  // ...
}
```

---

## 7. 代码骨架（long-press.ts）

```typescript
import { t } from './i18n';

const LONG_PRESS_MS   = 500;
const DIR_SAMPLE_PX   = 16;
const HORIZ_DEG       = 20;
const BOTTOM_FRACTION = 1 / 3;

let _active = false;
let _abortCtrl: AbortController | null = null;
let _osdEl: HTMLDivElement | null = null;
let _lastOsdHtml = '';

export function isLongPressActive(): boolean { return _active; }

export function initLongPress(video: HTMLVideoElement, getRate: () => number): void {
  if (navigator.maxTouchPoints <= 0) return;
  _abortCtrl?.abort();
  _abortCtrl = new AbortController();
  const sig = _abortCtrl.signal;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0, startY = 0, lastX = 0;
  let seekOffset = 0;
  let wasPaused = false;

  function bottomThird(): { top: number } {
    const r = video.getBoundingClientRect();
    return { top: r.top + r.height * (1 - BOTTOM_FRACTION) };
  }

  function enter(): void {
    _active = true;
    wasPaused = video.paused;
    if (video.paused) video.play().catch(() => {});
    video.playbackRate = getRate();
    try { navigator.vibrate(30); } catch {}
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

  document.body.addEventListener('touchstart', (e: TouchEvent) => {
    if (!video.isConnected || e.touches.length !== 1) return;
    const t0 = e.touches[0];
    if (t0.clientY < bottomThird().top) return;
    startX = lastX = t0.clientX;
    startY = t0.clientY;
    seekOffset = 0;
    timer = setTimeout(enter, LONG_PRESS_MS);
  }, { passive: true, signal: sig });

  document.body.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length > 1 && _active) {
      clearTimeout(timer!); timer = null;
      exit();
    }
  }, { passive: true, signal: sig });

  document.body.addEventListener('touchmove', (e: TouchEvent) => {
    if (!video.isConnected) return;
    const touch = e.touches[0];
    if (!touch) return;

    if (!_active) {
      if (!timer) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DIR_SAMPLE_PX) return;
      // 达到样本距离，判定方向
      const deg = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
      clearTimeout(timer); timer = null;
      // deg >= HORIZ_DEG → 纵向/模糊：gestures.ts 自行接管，无需额外操作
      // deg < HORIZ_DEG  → 横向：两边都不处理，直接忽略
      return;
    }

    // SPEEDING：增量累积 seekOffset
    const deltaX = touch.clientX - lastX;
    lastX = touch.clientX;
    const dur = isFinite(video.duration) ? video.duration : 0;
    const sPerVw = Math.max(0.1, Math.min(10, dur * 0.001));
    seekOffset += (deltaX / window.innerWidth * 100) * sPerVw;
    updateOsd(seekOffset);
  }, { passive: true, signal: sig });

  const onEnd = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (_active) exit();
  };
  document.body.addEventListener('touchend',    onEnd, { passive: true, signal: sig });
  document.body.addEventListener('touchcancel', onEnd, { passive: true, signal: sig });
}

// ── OSD ──────────────────────────────────────────────────────────────────────

function ensureOsd(): HTMLDivElement {
  if (!_osdEl) {
    _osdEl = document.createElement('div');
    _osdEl.className = 'jfs-speed-osd';
    document.body.appendChild(_osdEl);
  }
  return _osdEl;
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

// video 引用在外层闭包中，updateOsd 需要在 initLongPress 内定义以访问 video
// （此处骨架省略，实际实现内联）

function hideOsd(): void {
  if (_osdEl) { _osdEl.style.opacity = '0'; _lastOsdHtml = ''; }
}

function updateOsd(offsetSec: number /*, video: HTMLVideoElement */): void {
  const osd = ensureOsd();
  const rate = 2; // 实际从 getRate() 获取，内联时可用
  const rateTxt = rate % 1 === 0 ? `${rate}` : rate.toFixed(2);
  const line1 = t('longpress.speeding').replace('{rate}', rateTxt);

  let line2: string;
  if (Math.abs(offsetSec) < 0.05) {
    line2 = t('longpress.seekHint');
  } else {
    const sign = offsetSec >= 0 ? '+' : '−';
    // target 时间戳需要 video 引用，在内联实现时访问闭包变量
    // const target = clamp(video.currentTime + offsetSec, 0, dur);
    // line2 = `${sign}${formatOffset(Math.abs(offsetSec))}  →  ${formatTimestamp(target)}`;
    line2 = `${sign}${formatOffset(Math.abs(offsetSec))}`;
  }

  const html = `<div class="jfs-speed-osd__line1">▶▶ ${line1}</div>`
             + `<div class="jfs-speed-osd__line2">${line2}</div>`;
  if (html === _lastOsdHtml) return; // 避免无变化时 reflow
  _lastOsdHtml = html;
  osd.innerHTML = html;
  osd.style.opacity = '1';
}
```

---

## 8. styles.ts 新增

```css
.jfs-speed-osd {
  position: fixed;
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border-radius: 12px;
  padding: 12px 24px;
  text-align: center;
  pointer-events: none;
  z-index: 99999;
  opacity: 0;
  transition: opacity 0.25s ease-out;
  white-space: nowrap;
  min-width: 120px;
}

.jfs-speed-osd__line1 {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
}

.jfs-speed-osd__line2 {
  font-size: 14px;
  opacity: 0.75;
  margin-top: 4px;
  line-height: 1.4;
}
```

---

## 9. Backend / Frontend（变动最小）

**C# DTO**：

```csharp
[JsonPropertyName("speedRate")]
public double SpeedRate { get; set; } = 2.0;
```

**前端类型 + Panel**：新增 `enhancerSpeedLabel` / `enhancerSpeedUnit`（前者 "Long-press speed" / "长按加速倍率" / "長押し加速倍率"，后者 "×"）。面板输入：`min=1.25 max=4 step=0.25`。

**injector.ts 集成**（与 `_seekSeconds` 同模式）：

```typescript
let _speedRate = 2.0;

async function loadGestureConfig() {
  const cfg = await fetch(...).then(r => r.json());
  if (cfg.seekSeconds > 0) setSeekSeconds(cfg.seekSeconds);
  if (cfg.speedRate > 0)   _speedRate = cfg.speedRate;
}

// 视频元素切换时：
initLongPress(videoEl, () => _speedRate);
```
