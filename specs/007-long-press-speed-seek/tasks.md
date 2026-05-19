# Tasks: Long-Press Speed + Seek

**Input**: `specs/007-long-press-speed-seek/`
**Branch**: `feat/long-press-speed-seek`
**Prerequisites**: spec.md ✅ plan.md ✅

---

## Phase 1: 后端配置扩展

- [ ] T001 `PlayerEnhancerController.cs` 的 `GestureConfigDto` 增加 `SpeedRate` 字段（`[JsonPropertyName("speedRate")]`，默认 2.0），读写复用现有 `config.json` 机制

## Phase 2: 前端管理面板

- [ ] T002 `src/frontend/src/i18n/types.ts` 新增 `enhancerSpeedLabel: string`、`enhancerSpeedUnit: string`
- [ ] T003 `en.ts` / `zh.ts` / `ja.ts` 填充对应翻译（Long-press speed / 长按加速倍率 / 長押し加速倍率；`x` / `x` / `x`）
- [ ] T004 `PlayerEnhancerPanel.tsx` 在"Double-tap seek"行下方新增 speedRate 数字输入控件（min=1.25, max=4, step=0.25），联动保存到后端

## Phase 3: Player Enhancer — i18n

- [ ] T005 `src/player-enhancer/src/i18n.ts` 三个 locale 新增：
  - `longpress.speeding`：`Speeding ×{rate}` / `正在加速 ×{rate}` / `高速再生 ×{rate}`
  - `longpress.seekHint`：`← → to seek` / `← → 调节进度` / `← → でシーク`

## Phase 4: Player Enhancer — 样式

- [ ] T006 `src/player-enhancer/src/styles.ts` 新增 `.jfs-speed-osd`、`.jfs-speed-osd__line1`、`.jfs-speed-osd__line2` 样式（见 plan.md）

## Phase 5: Player Enhancer — 核心手势

- [ ] T007 新建 `src/player-enhancer/src/long-press.ts`，实现：
  - `isLongPressActive(): boolean` — 供 gestures.ts 查询状态
  - `initLongPress(videoEl, getSpeedRate)` — 完整状态机（IDLE / WAITING / SPEEDING）
  - 方向判定：累积 ≥ 16px 后计算角度，< 30° 为横向，≥ 30° 为纵向
  - 加速触发：500ms 长按 → `playbackRate = speedRate`、震动 30ms、显示 OSD
  - Seek 累积：仅在 SPEEDING 状态且长按已触发时响应横向移动，直接横滑不触发 seek
  - 退出：`playbackRate` 还原，若 `seekOffset ≠ 0` 则 `currentTime += offset`（clamp）
  - 多指中止：`e.touches.length > 1` 时立即退出
  - OSD：`ensureOsd()` 惰性创建，`showSpeedOsd(offset)` / `hideSpeedOsd()`（opacity transition）

- [ ] T008 `src/player-enhancer/src/gestures.ts` 修改：
  - 顶部 import `isLongPressActive` from `'./long-press'`
  - `touchmove` 的纵向分支（`directionLock === 'vertical'`）开头加守卫：`if (isLongPressActive()) return`

## Phase 6: 集成注入

- [ ] T009 `src/player-enhancer/src/injector.ts` 修改：
  - 顶部 import `initLongPress` from `'./long-press'`
  - `loadGestureConfig()` 中解析 `cfg.speedRate`，存入模块级 `_speedRate`（类比现有 `_seekSeconds`）
  - `jfs:seekSecondsChanged` 侦听器旁边新增自定义事件 `jfs:speedRateChanged`（或直接合并到同一配置刷新路径）
  - 在 `_currentVideoEl` 更新后（视频元素切换时）调用 `initLongPress(videoEl, () => _speedRate)`
  - **注意**：`initLongPress` 内部向 `document.body` 注册监听器，需处理旧监听器清理（视频切换时不重复累加）

## Phase 7: 构建 & 验证

- [ ] T010 `make build-enhancer` — TypeScript 无报错
- [ ] T011 `make update` — 部署到 jellyfin-dev 容器
- [ ] T012 在手机浏览器（或 Chrome DevTools 触摸模拟）验证所有 Acceptance Scenarios：
  - Story 1（长按加速）：触发、震动、OSD 显示、松手恢复
  - Story 2（加速时横滑 seek）：左右滑动偏移量正确，直接横滑不触发 seek
  - Story 3（手势零冲突）：垂直移动交还亮度/音量，多指中止，双击快进不受影响
  - Story 4（管理面板配置）：倍率修改后生效

## Phase 8: 提交 & 发布

- [ ] T013 commit + PR → main，标题：`feat: long-press speed-up with horizontal seek on mobile`
- [ ] T014 发布新版本（功能性新增 → minor bump，如 v1.6.0）
