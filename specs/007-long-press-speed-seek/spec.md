# Feature Specification: Long-Press Speed + Seek

**Feature Branch**: `feat/long-press-speed-seek`
**Created**: 2026-05-19
**Status**: Draft

## Background

移动端播放器已有上下滑动调节亮度/音量、双击快进/快退的手势。本功能补充"长按底部区域加速播放，同时左右滑动快速定位"，对标哔哩哔哩等主流移动视频 App 的交互模式。

## Clarifications

- Q: 加速倍率是否可配置？ → A: 是，通过插件管理面板配置，与双击快进秒数并列，默认 2x
- Q: 左右滑动灵敏度如何计算？ → A: 以 vw（视口宽度百分比）为单位，公式：`secondsPerVw = clamp(duration × 0.001, 0.1, 10)`；最小精度可达 0.1s，适配短视频；不用 px 是因为不同手机 DPI 差异大
- Q: 长按触发区域如何定义？ → A: 视频元素（`video.htmlvideoplayer`）`getBoundingClientRect()` 高度的底部 1/3，包含 object-fit: contain 产生的上下黑边
- Q: 长按与现有上下滑动手势的冲突如何处理？ → A: 在 500ms 等待期间识别移动方向——纵向移动先于长按触发则取消定时器交还给滑动手势，横向移动则取消定时器（无既有手势，直接忽略）；进入加速模式后所有纵向移动均被屏蔽
- Q: 进入加速模式是否需要震动反馈？ → A: 是，`navigator.vibrate(30)` 震动 30ms（无震动 API 时静默跳过）
- Q: OSD 显示位置？ → A: 屏幕顶部居中（`top: 15%`），不遮挡底部操作区域
- Q: 未发生横向滑动时释放，是否执行 seek？ → A: 否，仅恢复播放速率
- Q: 触摸多指时如何处理？ → A: 整个手势仅在单指触摸时生效，检测到多指立即中止

## Gesture State Machine

```
IDLE
  └─ touchstart（单指，底部 1/3 区域，非 OSD 控件）
       └─ 启动 500ms 定时器 → WAITING
            ├─ touchmove 纵向 > 12px（先于定时器）→ 取消定时器 → IDLE（交还滑动手势）
            ├─ touchmove 横向 > 12px（先于定时器）→ 取消定时器 → IDLE
            ├─ touchend / touchcancel → 取消定时器 → IDLE
            └─ 定时器触发 → 进入加速模式 → SPEEDING
                 ├─ video.playbackRate = speedRate
                 ├─ navigator.vibrate(30)
                 ├─ 显示 OSD：图标 + "×{rate}" + "← → 调节进度"
                 └─ touchmove 横向 → 累计 seekOffset，OSD 更新偏移量 → SPEEDING（seek 中）
                      └─ touchend / touchcancel
                           ├─ video.playbackRate 还原
                           ├─ if seekOffset ≠ 0 → video.currentTime = clamp(currentTime + seekOffset, 0, duration)
                           └─ 隐藏 OSD → IDLE
```

## Seek Sensitivity Formula

```
deltaVw = deltaPixels / window.innerWidth × 100
secondsPerVw = clamp(video.duration × 0.001, 0.1, 10)
seekOffset += deltaVw × secondsPerVw
```

示例（单次 50vw 横滑）：

| 内容时长 | s/vw | 50vw 偏移 |
|---------|------|----------|
| 2h 电影 | 7.2 (capped 10) | 500s ≈ 8min |
| 24min 番剧 | 1.44 | 72s ≈ 1.2min |
| 3min 短片 | 0.18 | 9s |
| 30s 片段 | 0.10 (min) | 5s |

## OSD Design

位置：`position: fixed; top: 15%; left: 50%; transform: translateX(-50%)`

内容（两种状态）：

```
无 seek 偏移时：
  ┌──────────────────────┐
  │  ▶▶  ×2.0           │
  │  ←  →  调节进度      │
  └──────────────────────┘

有 seek 偏移时（替换提示行）：
  ┌──────────────────────┐
  │  ▶▶  ×2.0           │
  │  + 1m 23.5s         │  ← 负数为"-"
  └──────────────────────┘
```

样式参考现有 `.jfs-enhancer-osd`，新增 `.jfs-enhancer-speed-osd`（不复用，位置和内容结构不同）。

## Configurable Parameters

| 参数 | 类型 | 默认值 | 范围 | 说明 |
|-----|------|-------|------|-----|
| `speedRate` | float | 2.0 | 1.25 – 4.0 | 加速倍率，在管理面板以 step=0.25 调节 |

后端 DTO 扩展 `GestureConfigDto`（现有 `seekSeconds` 字段同文件）。

## Internationalization

新增 player enhancer i18n key（`src/player-enhancer/src/i18n.ts`）：

| key | en | zh | ja |
|-----|----|----|-----|
| `longpress.speeding` | `Speeding ×{rate}` | `正在加速 ×{rate}` | `高速再生 ×{rate}` |
| `longpress.seekHint` | `← → to seek` | `← → 调节进度` | `← → でシーク` |

（`{rate}` 为运行时替换占位符，非 i18n 系统处理）

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 长按加速播放 (Priority: P1)

移动端用户想临时提速浏览视频内容，不需要打开 OSD 找速度按钮。

**Independent Test**: 手机上长按视频底部约半秒，视频变速播放，屏幕顶部出现加速 OSD，松手恢复。

**Acceptance Scenarios**:

1. **Given** 单指触摸视频底部 1/3 区域，**When** 持续按住超过 500ms 无明显移动，**Then** 视频切换到配置倍率播放，震动 30ms，OSD 显示"×N"
2. **Given** 处于加速模式，**When** 松手，**Then** 立即恢复原播放速率，OSD 消失
3. **Given** 视频已暂停，**When** 长按触发加速，**Then** 视频开始播放并加速（松手后恢复暂停）
4. **Given** 多指触摸，**When** 原有单指上再按下第二根手指，**Then** 立即中止加速模式，恢复播放速率

### User Story 2 - 加速时横滑定位 (Priority: P1)

用户在加速浏览时发现目标片段，想粗略定位，不需要松手重新拖进度条。

**Independent Test**: 长按触发加速后，横向滑动手指，松手后播放位置相应偏移。

**Acceptance Scenarios**:

1. **Given** 处于加速模式，**When** 向右横滑 50vw，**Then** `seekOffset = 50 × secondsPerVw`，OSD 显示正偏移量
2. **Given** 处于加速模式，**When** 向左横滑，**Then** OSD 显示负偏移量
3. **Given** 横滑后松手，**When** seekOffset ≠ 0，**Then** `video.currentTime` 精确移动对应秒数（clamp 至 0 和 duration）
4. **Given** seekOffset 超过剩余时长，**When** 松手，**Then** 跳转到视频末尾，不报错
5. **Given** 视频时长 30s，**When** 100vw 横滑，**Then** 偏移量不超过 10s（最小灵敏度下限 0.1 s/vw × 100）

### User Story 3 - 与现有手势零冲突 (Priority: P1)

**Acceptance Scenarios**:

1. **Given** 触摸底部 1/3，**When** 在 500ms 内开始垂直滑动，**Then** 长按取消，亮度/音量手势正常触发
2. **Given** 触摸底部 1/3 以外区域，**When** 长按，**Then** 不进入加速模式
3. **Given** 处于加速模式，**When** 手指垂直移动，**Then** 不触发亮度/音量调节
4. **Given** 正常播放，**When** 双击左/右，**Then** 双击快进/快退正常工作，不受长按逻辑干扰

### User Story 4 - 管理面板配置 (Priority: P2)

**Acceptance Scenarios**:

1. **Given** 管理员打开插件管理面板，**Then** 可见"长按加速倍率"配置项，默认 2.0
2. **Given** 管理员修改倍率并保存，**When** 移动端下次长按，**Then** 使用新倍率
