# Data Model: Trickplay Seek Preview

**Feature**: 008-trickplay-seek-preview  
**Date**: 2026-05-22

---

## Types

### TrickplayEntry

服务端返回的单个宽度元数据（来自 Jellyfin API）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `TileWidth` | `number` | 每张 sprite sheet 的列数 |
| `TileHeight` | `number` | 每张 sprite sheet 的行数 |
| `ThumbnailCount` | `number` | 该视频的总缩略图帧数 |
| `Interval` | `number` | 相邻帧间隔（毫秒） |
| `Bandwidth` | `number` | 估算带宽（bytes/s），用于宽度选择参考 |

### TrickplayMeta

本地缓存的解析结果（已选定宽度）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `selectedWidth` | `number` | 实际使用的缩略图宽度（px，每帧）|
| `entry` | `TrickplayEntry` | 该宽度对应的元数据 |
| `thumbPixelH` | `number \| null` | 首次加载 sheet 后测得的每帧高度（px）；null = 未测量 |
| `sheetUrlBase` | `string` | sprite sheet URL 前缀（不含 sheetIndex.jpg）|

### TrickplayCache

模块级内存缓存：

| 字段 | 类型 | 说明 |
|------|------|------|
| `itemId → TrickplayMeta \| null` | `Map` | null = 已确认服务端无数据，不再重试 |

### FrameLocation

给定时间点的帧在 sprite sheet 中的位置：

| 字段 | 类型 | 说明 |
|------|------|------|
| `sheetIndex` | `number` | 第几张 sprite sheet（0-based）|
| `col` | `number` | 帧在 sheet 中的列（0-based）|
| `row` | `number` | 帧在 sheet 中的行（0-based）|

### ThumbDisplaySize

多标准动态计算出的缩略图展示尺寸：

| 字段 | 类型 | 说明 |
|------|------|------|
| `displayW` | `number` | 容器宽度（px），横向/竖向视频共用 |
| `displayH` | `number` | 容器高度（px），等比缩放后取值 |

---

## 内存生命周期

```
video element 挂载
  └─ initTrickplay(itemId, videoEl)
       ├─ 查 TrickplayCache[itemId]
       │    ├─ hit (TrickplayMeta) → 预加载首张 sheet
       │    ├─ null               → 跳过
       │    └─ miss               → fetch metadata → 缓存 → 预加载首张 sheet
       │
       └─ 每次 long-press 横滑（seekOffset ≠ 0）
            └─ computeFrame(positionMs, meta)
                 └─ updateThumb(frameLocation, meta, videoEl)
                      ├─ 计算 ThumbDisplaySize
                      ├─ 构造 sheetUrl
                      └─ 设置 OSD thumb 容器的 CSS

video element 卸载（injector 检测到新 video）
  └─ TrickplayCache 保留（跨视频复用，如播完自动播下一集）
     thumbPixelH 保留于 TrickplayMeta 内（不重测）
```

---

## 模块接口（trickplay.ts 导出）

```typescript
/** 初始化：fetch 元数据并预加载首张 sheet。幂等，同 itemId 重复调用无副作用。 */
export function initTrickplay(itemId: string, videoEl: HTMLVideoElement): void

/** 在 OSD 内渲染指定时间点的缩略图。positionMs = video.currentTime * 1000 */
export function showTrickplayThumb(
  positionMs: number,
  videoEl: HTMLVideoElement,
  osdEl: HTMLDivElement,
): void

/** 移除 OSD 内的缩略图区块（seekOffset 归零或手势结束时调用）*/
export function hideTrickplayThumb(osdEl: HTMLDivElement): void
```
