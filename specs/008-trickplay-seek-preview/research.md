# Research: Trickplay Seek Preview

**Feature**: 008-trickplay-seek-preview  
**Date**: 2026-05-22

---

## Decision 1: Trickplay API 端点与鉴权

**Decision**: 使用 Jellyfin 内置 Trickplay REST API，通过 `ApiClient` 获取 auth token。

**Rationale**:
- `GET /Videos/{itemId}/Trickplay` 返回全部可用宽度的元数据（interval、TileWidth、TileHeight、ThumbnailCount）
- `GET /Videos/{itemId}/Trickplay/{width}/{sheetIndex}.jpg` 返回 sprite sheet 图像
- Auth token 读取：`(window as any).ApiClient?.accessToken?.() ?? (window as any).ApiClient?._accessToken`
- Base URL 读取：`(window as any).ApiClient?.serverAddress?.() ?? (window as any).ApiClient?._serverAddress ?? ''`
- 此模式与现有 player-enhancer 中 `fetch('/JellyfinSuite/...')` 同路径，不引入新依赖

**Alternatives considered**: 无需考虑替代，服务端数据已存在。

---

## Decision 2: Sprite Sheet 帧定位算法

**Decision**: 纯数学计算，无需 canvas 操作。

```
thumbIndex  = Math.floor(positionMs / intervalMs)
tilesPerSheet = TileWidth * TileHeight
sheetIndex  = Math.floor(thumbIndex / tilesPerSheet)
posInSheet  = thumbIndex % tilesPerSheet
col         = posInSheet % TileWidth
row         = Math.floor(posInSheet / TileWidth)
```

单帧像素尺寸：
- `thumbPixelW` = 请求的 `width` 参数（即每个缩略图宽度，如 160px）
- `thumbPixelH` = 首次加载 sprite sheet 后 `img.naturalHeight / TileHeight`（真实高度，不假设比例）

**Rationale**: 计算 O(1)，完全同步；sprite sheet 由浏览器 HTTP 缓存管理，加载后即可复用。

**Alternatives considered**: canvas 截取（需跨域权限，不必要）。

---

## Decision 3: CSS 渲染方式（background vs img + clip）

**Decision**: CSS `background-image + background-size + background-position`，配合 `background-color` 填充竖向视频空白。

```css
.jfs-speed-osd__thumb {
  background-image: url("{sheetUrl}");
  background-size: {TileWidth * displayW}px {TileHeight * displayH}px;
  background-position: {-col * displayW}px {-row * displayH}px;
  background-color: #000;   /* 竖向视频左右黑边 */
  background-repeat: no-repeat;
  width: {displayW}px;
  height: {displayH}px;
}
```

这里 `displayW × displayH` 是容器固定尺寸（由多标准算法给出），与 `thumbPixelW × thumbPixelH` 的比例一致但可放大/缩小。

**Rationale**: 无需 DOM 操作图片元素，background 属性可通过 `element.style` 直接动态更新，重绘代价极低；background-color 天然实现竖向视频 pillarbox，无需额外计算。

**Alternatives considered**: `<img>` + CSS clip（需操作多属性 + overflow:hidden 容器），略复杂。

---

## Decision 4: 多标准缩略图尺寸计算

**Decision**: 同时取 viewport 和 video bounding rect 两个来源的约束，选最严值，保持真实长宽比。

```typescript
function computeThumbDisplaySize(
  thumbPixelW: number,
  thumbPixelH: number,
  video: HTMLVideoElement
): { displayW: number; displayH: number } {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const vr = video.getBoundingClientRect();
  // 可用空间约束（取两者较严）
  const maxW = Math.min(vp.w * 0.45, vr.width  * 0.50);
  const maxH = Math.min(vp.h * 0.40, vr.height * 0.40);
  // 等比缩放到约束框内
  const aspect = thumbPixelW / thumbPixelH;
  let w = Math.min(thumbPixelW, maxW);
  let h = w / aspect;
  if (h > maxH) { h = maxH; w = h * aspect; }
  return { displayW: Math.round(w), displayH: Math.round(h) };
}
```

对于竖向视频（aspect < 1），容器宽度由 `displayW` 固定，高度 `displayH` 同样受 maxH 约束；`background-color: #000` 自动填充两侧空白。

**Rationale**: 同时兼顾小屏手机（受 viewport 约束）和小窗播放（受 playerRect 约束）场景；百分比比例经测试适合大多数设备，规划阶段可调整。

**Alternatives considered**: 固定 240px（不响应屏幕变化）、单一基准（只取 viewport 或只取 playerRect）——均劣于多标准。

---

## Decision 5: OSD 垂直居中参考

**Decision**: 以 `video.getBoundingClientRect()` 中心点为参考（而非 viewport 中心）。

```css
/* 新位置（替换原 top: 15%）*/
.jfs-speed-osd {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
```

加载缩略图后 OSD 高度增大，垂直方向仍以自身中心为锚点——如发现 OSD 超出 playerRect，注入时动态修正 `top` 值（`playerRect.top + playerRect.height/2`，转为 px）。默认 CSS 居中对全屏场景完全准确（playerRect ≈ viewport）。

**Alternatives considered**: 用 video bounding rect 动态算 top px（精确但每次 seek 需重算 DOM rect，代价略高）。

---

## Decision 6: Trickplay 宽度选择

**Decision**: 取所有可用宽度中最接近 160px 的（优先 ≤160，其次最小值）。

```typescript
function selectWidth(widths: number[]): number {
  const below = widths.filter(w => w <= 160).sort((a, b) => b - a);
  return below[0] ?? Math.min(...widths);
}
```

**Rationale**: 160px 是 Jellyfin 默认生成的最低宽度，带宽最小；预览框放大时质量也可接受。

---

## Decision 7: 缓存策略

**Decision**:
- Trickplay 元数据：`Map<itemId, TrickplayMeta | null>` 内存缓存，null = 已确认无数据
- Sprite sheet 图像：由浏览器 HTTP 缓存管理，JS 侧只保留已知的 `naturalHeight` 首次量测结果（避免重新 load）
- 预加载时机：injector 检测到新 video element 后异步 fetch 元数据 + 首张 sheet；seek 发生时大概率已缓存

**Rationale**: Sprite sheet 可能多张（长视频），全量预加载浪费带宽；按需 + 浏览器缓存是最优策略。首张预加载保证第一次 seek 无延迟。
