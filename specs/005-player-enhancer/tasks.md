# Tasks: Web Player Enhancer

**Input**: `specs/005-player-enhancer/`  
**Branch**: `feature/005-player-enhancer`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅

**Tests**: 仅 Phase 8 Polish 包含纯逻辑单元测试（spec 未强制 TDD）。

---

## Phase 0: 插件改名（Jellyfin Recents → Jellyfin Suite）

**Purpose**: 在实现 005 功能前，完成全插件改名并修复已知 bug；属于现有代码库清理，与 005 并列独立

⚠️ **Phase 0 必须在 Phase 1 之前完成**

- [x] R001 新建 `src/JellyfinSuite.Plugin/PluginConstants.cs`，定义五个常量：`PluginName = "Jellyfin Suite"`、`TaskCategory`、`TaskKeyPrefix = "JellyfinRecents"`、`DatabaseFileName = "jellyfin-recents.db"`、`PosterTempPrefix = "postersheet-"`
- [x] R002 [P] 更新 `src/JellyfinSuite.Plugin/Plugin.cs`：`Name` 属性 → `PluginConstants.PluginName`，更新 `Description` 为 "A Jellyfin plugin suite: recently played view, poster sheet generator, and web player enhancer."
- [x] R003 [P] 批量更新 6 个 Task 文件（`Clean*.cs`）中的 `Category = "Jellyfin Recents"` → `PluginConstants.TaskCategory`
- [x] R004 [P] 修 bug：`CleanInvalidRecordsTask.cs` 将 `Type = "DailyTrigger"` 改为 `TaskTriggerInfo.TriggerDaily`
- [x] R005 [P] 消除重复：`CleanPosterSheetsTask.cs` 删除 `private const string TempPrefix`，改为引用 `PluginConstants.PosterTempPrefix`；`PosterSheetJobService.cs` 同步替换
- [x] R006 [P] 更新 `src/JellyfinSuite.Plugin/PluginServiceRegistrator.cs` 中的 DB 路径字符串 → `PluginConstants.DatabaseFileName`（引用常量，行为不变）
- [x] R007 [P] 更新 `src/JellyfinSuite.Plugin/meta.json`：`name` → `"Jellyfin Suite"`，`description` → 新描述，`targetAbi` → `"10.10.7.0"`；同时修复 `Makefile` 的 `update` target，追加 `docker cp meta.json` 步骤
- [x] R008 [P] 更新 `manifest.json`：两条 entry 的 `name`/`description`/`overview`（base 改为 "Jellyfin Suite"，bundled 改为 "Jellyfin Suite + Fonts"）；两条 `targetAbi` 均改为 `"10.10.7.0"`
- [x] R009 [P] 更新 `.github/workflows/release.yml`：zip 文件名 `jellyfin-recents_*.zip` → `jellyfin-suite_*.zip`；bundled jq 中的 `"Jellyfin Recents + Fonts"` → `"Jellyfin Suite + Fonts"`；manifest 步骤中的 `targetAbi` → `"10.10.7.0"`（`JellyfinRecents.Plugin.dll` / `.csproj` 引用不变，AssemblyName 保持）；`build.yml` 无需改动；重命名 `jellyfin-recents.sln` → `jellyfin-suite.sln`（无其他文件引用，构建不受影响）
- [x] R010 [P] 更新 `README.md` 和 `README.zh-CN.md`：标题改为 Jellyfin Suite，描述涵盖三大功能（最近播放、海报生成器、播放器增强）
- [x] R011 新建 `src/frontend/src/constants.ts`，集中管理前端插件级常量（与 C# 侧 `PluginConstants.cs` 对称）：
  ```ts
  export const PLUGIN_NAME         = 'Jellyfin Suite';
  export const PLUGIN_DEVICE_ID    = 'jellyfin-suite-browser';
  export const SETTINGS_KEY        = 'jellyfin-suite-settings';
  export const SETTINGS_KEY_LEGACY = 'jellyfin-recents-settings';  // 迁移用
  ```
- [x] R012 [P] 引用 `constants.ts` 替换散落的硬编码字符串（以下不影响 API 路由和 DOM 绑定，安全可改）：
  - `src/frontend/src/api/posterSheetApi.ts`：`brandingText` 默认值 → `'Jellyfin Suite'`
  - `src/frontend/src/components/PosterSheetSettingsPanel.tsx`：同上 `brandingText` 默认值 → `'Jellyfin Suite'`
  - `src/frontend/src/api/jellyfinClient.ts`：`clientInfo.name` → `'Jellyfin Suite'`，`deviceInfo.id` → `'jellyfin-suite-browser'`
  - `src/frontend/src/components/PlayRecordCard.tsx`：日志前缀 → `[JellyfinSuite]`
  - `src/frontend/src/styles.css`：文件头注释更新
  - `src/frontend/package.json`：`name` → `"jellyfin-suite-frontend"`（private 包，lock.json 自动同步）
  - `src/JellyfinSuite.Plugin/Models/PosterSheetJob.cs`：`BrandingText` 默认值 → `"Jellyfin Suite"`（用户可见，出现在海报水印中）
- [x] R013 [P] 前端 localStorage 迁移：`src/frontend/src/state/viewSettings.ts`，将 `STORAGE_KEY` 改为引用 `SETTINGS_KEY`，并在读取前加一次性迁移——若 `SETTINGS_KEY_LEGACY` 存在则将其值复制到 `SETTINGS_KEY` 后删除旧键（不迁移则用户已保存的视图设置丢失）
- [x] R014 [P] 更新 Rust 端：
  - `src/poster-gen/src/main.rs`：在文件顶部提取 `const BRANDING_DEFAULT: &str = "Jellyfin Suite";`，两处 `default_value = "Jellyfin Recents"` → `default_value = BRANDING_DEFAULT`；更新 doc 注释
  - `src/poster-gen/src/qr.rs`：`QR_URL` 值暂留，待 R015 执行后改为新 repo URL
  - `text_renderer.rs` 测试中的 `"Jellyfin Recents"` 字符串**不改**（仅作哈希一致性测试用的任意输入，与名称无关）
- [ ] R015 在代码合并到 main 后，执行 `gh repo rename jellyfin-suite`，同时更新 `qr.rs` 中的 `QR_URL` 为新 repo 地址，完成 GitHub repo 改名（最后一步）

**Checkpoint**: `make build` 成功；`Plugin.Name` 返回 `"Jellyfin Suite"`；6 个 Task `Category` 显示 "Jellyfin Suite"；`meta.json` 与 manifest.json 内容一致；`make update` 后容器插件列表显示新名称

---

## Phase 1: Setup（项目初始化）

**Purpose**: 建立 `src/player-enhancer/` 独立包并接入构建流水线

- [x] T001 新建 `src/player-enhancer/package.json`，添加 vite + typescript 依赖，配置 `build` 脚本
- [x] T002 新建 `src/player-enhancer/tsconfig.json`，target ESNext，moduleResolution bundler，严格模式
- [x] T003 新建 `src/player-enhancer/vite.config.ts`，ESM lib 格式，输出 `jellyfin-suite-enhancer.js` 至 `src/JellyfinSuite.Plugin/Web/`
- [x] T004 [P] 更新 `Makefile` build target，追加 `cd src/player-enhancer && npm run build`
- [x] T005 [P] 更新 `src/JellyfinSuite.Plugin/Plugin.cs`，追加 `JellyfinSuitePlayerEnhancer` 的 `PluginPageInfo`（`EmbeddedResourcePath` 指向 `jellyfin-suite-enhancer.js`，不含 `EnableInMainMenu`）

**Checkpoint**: `npm run build` 在 player-enhancer 目录可执行，产物路径正确

---

## Phase 2: Foundation（基础设施，阻塞所有 US）

**Purpose**: 所有 US 共用的类型、i18n、图标、CSS 注入、DOM 注入器、C# 自动注入 EntryPoint

⚠️ **所有 US 必须等待本阶段完成后才能开始**

- [x] T006 新建 `src/player-enhancer/src/types/jellyfin.ts`，定义精简 interface：`MediaStream`、`MediaSource`、`PlaybackManager`、`JellyfinPluginDeps`（含 `playbackManager`、`events`）
- [x] T007 [P] 新建 `src/player-enhancer/src/i18n.ts`，实现 `t(key)` 函数；语言检测顺序：`document.documentElement.lang` → `navigator.language` → `'en'`；使用前缀最优匹配（`zh-*` → zh，`ja-*` → ja，其他 → en）；包含 zh/ja/en 完整翻译 key（帧步进 tooltip × 4、截图 × 2、OSD 标签 × 2、提示信息 × 3）
- [x] T008 [P] 新建 `src/player-enhancer/src/icons.ts`，导出帧步进四个 SVG 字符串常量（`F-10` `F-1` `F+1` `F+10`，双行 text SVG：上行大字 `F`，下行小字修饰符；`font-size="13/10"` `font-weight="800/700"`）及截图图标 SVG（camera 图形）
- [x] T009 [P] 新建 `src/player-enhancer/src/styles.ts`，导出 `injectStyles()` 函数，向 `document.head` 插入带 `id="jfs-enhancer-styles"` 的 `<style>` 标签；所有选择器以 `.jfs-enhancer-` 前缀隔离
- [x] T010 在 `src/JellyfinSuite.Plugin/Configuration/PluginConfiguration.cs` 追加 `bool AutoInjectEnabled { get; set; } = true;` 字段；新建 `PlayerEnhancerEntryPoint.cs`，实现 `IHostedService`：`StartAsync()` 先检查 `Plugin.Instance.Configuration.AutoInjectEnabled`，为 `false` 时直接返回，否则读取 `IApplicationPaths.WebPath + "/config.json"` 幂等追加 enhancer URL，写入失败时记录警告不抛出异常
- [x] T011 新建 `src/player-enhancer/src/injector.ts`，实现 `initInjector(playbackManager, events)`：MutationObserver 监听 `document.body` 检测 `.videoPlayerContainer`，同时 `Events.on(playbackManager, 'playbackstart', ...)` 兜底；幂等注入（检查 `#jfs-enhancer-root` 是否已存在）；调用 `injectStyles()`
- [x] T012 新建 `src/player-enhancer/src/index.ts`，`export default class PlayerEnhancerPlugin`，构造函数调用 `injectStyles()` 和 `initInjector(playbackManager, events)`

**Checkpoint**: 构建产物加载后，播放任意视频时 DevTools 可见 `.videoPlayerContainer` 内出现 `#jfs-enhancer-root` 容器（暂无子元素）

---

## Phase 3: US1 — 帧步进控制（P1）🎯 MVP

**Goal**: OSD 底部出现四个帧步进按钮，精确按帧移动画面

**Independent Test**: 打开任意视频，OSD 可见 `F-10 F-1 F+1 F+10` 四按钮（双行 text SVG：上行大字 `F`，下行小字修饰符）；点击 `F+1` 后画面前进一帧并保持暂停

- [x] T013 [US1] 新建 `src/player-enhancer/src/fps-cache.ts`，实现 `getFps(itemId)` 异步函数：调用 `window.ApiClient.getJSON('/Items/{id}')` 取 `MediaSources[0].MediaStreams` 中 video stream 的 `RealFrameRate ?? AverageFrameRate ?? 24`，结果以 itemId 为 key 缓存至 Map
- [x] T014 [US1] 新建 `src/player-enhancer/src/framestepper.ts`，实现：
  - `createFrameStepButtons()` 返回包含四个 `<button>` 的容器 div，按钮使用 `icons.ts` 中的 SVG，`title` 属性调用 `t()` 获取 tooltip
  - `stepFrames(videoEl, delta, itemId)` 异步函数：获取 fps → 若播放中先暂停 → `currentTime = clamp(currentTime + delta/fps, 0, duration)`
- [x] T015 [US1] 在 `src/player-enhancer/src/injector.ts` 中接入帧步进：将 `createFrameStepButtons()` 结果 `prepend` 至 `.osdControls .buttons.focuscontainer-x`，绑定四个按钮的 click 事件（-10f / -1f / +1f / +10f）；从 `playbackManager.currentItem()` 获取 `itemId` 传入 `stepFrames`

**Checkpoint**: US1 完整可验收，帧步进精度与 fps 一致，边界不越界

---

## Phase 4: US2 — 截图保存（P2）

**Goal**: OSD 出现截图按钮 + 字幕 Switch，一键下载当前帧 PNG

**Independent Test**: 暂停视频，点击截图按钮，浏览器下载 PNG，分辨率 = 视频编码分辨率，不含黑边

- [x] T016 [US2] 新建 `src/player-enhancer/src/screenshot.ts`，实现 `takeScreenshot(videoEl, includeSubtitles)`：
  - `OffscreenCanvas(videoEl.videoWidth, videoEl.videoHeight)`
  - `ctx.drawImage(videoEl, 0, 0, w, h)`，catch `SecurityError` → 调用 `t('screenshot.drm')` 显示 toast
  - 若 `includeSubtitles`：尝试 `drawImage('.libassjs-canvas-parent canvas')` 叠加 ASS 字幕（不存在则静默跳过）
  - `canvas.convertToBlob({ type: 'image/png' })` → 触发下载，文件名 `jellyfin-screenshot-{itemTitle}-{Date.now()}.png`（itemTitle 取自 `playbackManager.currentItem()?.Name`，非法字符替换为下划线）；截图为客户端纯内存操作，不产生服务端文件
  - **已知 v1 限制**：若亮度经手势调节，截图像素为原始亮度（CSS `filter` 不影响 `drawImage` 读取的像素值），截图与屏幕显示存在亮度差异，不作为缺陷处理
- [x] T017 [US2] 在 `src/player-enhancer/src/injector.ts` 中接入截图：
  - 创建截图按钮（使用 `icons.ts` SVG，tooltip 调用 `t()`）
  - 创建字幕 Switch（`<label>` + `<input type="checkbox">`，默认 unchecked；不持久化——每次播放器初始化重置，不读写 localStorage）
  - 将按钮与 Switch 追加至帧步进按钮容器，绑定 click 事件调用 `takeScreenshot`

**Checkpoint**: US2 完整可验收，含字幕 / 不含字幕两种模式均正确，DRM 内容显示提示

---

## Phase 5: US3 — 移动端双击手势（P3）

**Goal**: 触控设备上三区域双击：左退 10s / 中暂停恢复 / 右进 10s，左右区域显示 ripple 动画

**Independent Test**: Chrome 设备模式下，双击左侧 1/3 退 10s 并显示 `-10s` ripple；双击中间 1/3 切换暂停；双击右侧 1/3 进 10s；桌面端无响应

- [x] T018 [US3] 新建 `src/player-enhancer/src/osd-overlay.ts`，实现 `showRipple(side: 'left' | 'right', label: string)`：YouTube 风格动画——贴屏边的半透明半椭圆（`.jfs-enhancer-ripple-bg`），内含三个 `›`/`‹` 字符（`.jfs-enhancer-ripple-arrow`）做向目标方向平移的 stagger keyframe 动画（delay 0/0.18/0.36s），label 显示 `+10s`/`-10s`；右侧快进时 label 在箭头下方，左侧快退时 label 在箭头下方（结构：`ripple-bg > [ripple-arrows, ripple-label]`）；纯 DOM + CSS，1s 后 `remove()`
- [x] T019 [US3] 新建 `src/player-enhancer/src/gestures.ts`，实现 `initGestures(videoEl, playbackManager)`：
  - `navigator.maxTouchPoints > 0` 检查，否则直接返回
  - `touchend` 事件（`capture: true`）三区域双击检测：`zone = x < W/3 ? 'left' : x < 2W/3 ? 'center' : 'right'`；300ms 窗口内同 zone 第二次 tap → 触发对应操作；`preventDefault()` + `stopPropagation()` 阻止 Jellyfin OSD 单击行为
  - 左/右：`videoEl.currentTime ± 10`，调用 `showRipple()`；中：`videoEl.paused ? videoEl.play() : videoEl.pause()`
- [x] T020 [US3] 在 `src/player-enhancer/src/injector.ts` 中调用 `initGestures(videoEl, playbackManager)`

**Checkpoint**: US3 完整可验收，三区域触发正确，桌面端无副作用

---

## Phase 6: US4 — 移动端滑动亮度/音量（P4）

**Goal**: 触控设备上，左半屏上下滑调亮度，右半屏上下滑调音量，屏幕中央显示 OSD 百分比指示器

**Independent Test**: Chrome 设备模式下，在左侧向上拖拽，画面变亮且 OSD 显示亮度百分比；新视频开始时亮度自动重置 100%

- [x] T021 [US4] 在 `src/player-enhancer/src/osd-overlay.ts` 中追加 `showValueOsd(type: 'brightness' | 'volume', value: number)` 函数：屏幕中央半透明浮层，显示图标 + 百分比数字，1.5s 后自动隐藏
- [x] T022 [US4] 在 `src/player-enhancer/src/gestures.ts` 中追加滑动控制逻辑（`touchstart` / `touchmove` / `touchend`，`passive: false`）：
  - `touchstart`：记录 `startX`、`startY`、`side`（左/右半屏）、初始值（亮度/音量）、`directionLock = null`
  - `touchmove`：**方向锁定**——移动超过 10px 后通过 `|dy| >= |dx|` 判定为纵向锁定，否则标记横向并忽略后续事件（允许用户斜向滑动，只要大体纵向即可）；`delta = (startY - currentY) / (innerHeight * 0.5)`
    - 纵向锁定后，左：`brightness = clamp(start + delta, 0, 2.0)`，`videoEl.style.filter = brightness(${v})`，调用 `showValueOsd`
    - 纵向锁定后，右：`volume = clamp(start + delta, 0, 1)`，`videoEl.volume = v`，调用 `showValueOsd`
  - `touchend`：重置 swipe 状态（含 `directionLock`）
- [x] T023 [US4] 在 `src/player-enhancer/src/injector.ts` 中监听 `playbackstart` 事件，重置 `videoEl.style.filter = 'brightness(1)'`

**Checkpoint**: US4 完整可验收，边界不越界，新视频亮度自动重置，桌面端无副作用

---

## Phase 7: US5 — 注入管理 UI（P5）

**Goal**: "最近播放"设置面板中显示注入状态，支持手动重新注入和卸载

**Independent Test**: 以管理员账号打开设置面板，可见注入管理区域及状态标签；点击"重新注入"后标签更新为已启用并提示刷新；点击"卸载注入"后更新为已禁用；以普通用户账号打开，注入管理区域不可见

- [x] T024 [US5] 新建 `src/JellyfinSuite.Plugin/Controllers/PlayerEnhancerController.cs`，实现三个 endpoint，**全部加 `[Authorize(Policy = Policies.RequiresElevation)]`**（仅 Jellyfin 管理员可调用）：
  - `GET /JellyfinSuite/PlayerEnhancer/Status` → `{ autoInjectEnabled: bool }`（读 `Plugin.Instance.Configuration.AutoInjectEnabled`）
  - `POST /JellyfinSuite/PlayerEnhancer/Inject` → `AutoInjectEnabled = true` → `SaveConfiguration()` → 幂等追加 URL；失败时返回 500 含错误描述
  - `DELETE /JellyfinSuite/PlayerEnhancer/Inject` → `AutoInjectEnabled = false` → `SaveConfiguration()` → 移除 URL；失败时返回 500 含错误描述
  - 提取共享 `PlayerEnhancerConfigPatcher` 静态工具类（供 T010 的 EntryPoint 共用 config.json 读写）；同步重构 T010 使用此工具类
- [x] T025 [P] [US5] 新建 `src/frontend/src/api/playerEnhancerApi.ts`，封装三个 API 调用函数：`getEnhancerStatus()` → `{ autoInjectEnabled: bool }`、`injectEnhancer()`、`removeEnhancer()`，使用项目现有 `jellyfinClient` 模式；收到 401/403 时向调用方抛出（正常路径由 T026 的 `IsAdministrator` 前置检查保证不触发）
- [x] T026 [US5] 新建 `src/frontend/src/components/PlayerEnhancerPanel.tsx`（Preact 组件）：
  - **仅对管理员渲染**：通过 `jellyfinClient.getCurrentUser().Policy.IsAdministrator` 判断，非管理员直接返回 `null`
  - 挂载时调用 `getEnhancerStatus()` 获取并显示状态（● 已启用 / ○ 已禁用）；状态基于 `autoInjectEnabled`
  - "重新注入"按钮：调用 `injectEnhancer()`，成功后刷新状态，显示"请刷新页面生效"提示；**失败时显示错误 toast 并附加"查看服务端日志"引导，按钮恢复可点击，状态不变**
  - "卸载注入"按钮：调用 `removeEnhancer()`，成功后刷新状态；**失败时同上错误处理**
  - 操作执行中按钮 disabled + loading 状态防重复提交
- [x] T027 [P] [US5] 将 `PlayerEnhancerPanel` 集成到现有设置面板（`SettingsPopover` 或对应区块）
- [x] T028 [P] [US5] 在 `src/frontend/src/i18n/locales/en.ts`、`zh.ts`、`ja.ts` 中添加管理 UI 的三语翻译 key（状态标签、按钮文字、提示信息）

**Checkpoint**: US5 完整可验收，三个 API endpoint 正确响应，UI 状态实时刷新

---

## Phase 8: Polish & 收尾

**Purpose**: 完善细节，覆盖遗漏的边界行为

- [ ] T029 [P] 完善 `src/player-enhancer/src/styles.ts` 中所有 UI 组件的 CSS（按钮 hover/active 状态、OSD 动画、ripple 动画、Switch 样式）；确认 `.jfs-enhancer-` 前缀无泄漏
- [ ] T030 [P] 新建 `tests/player-enhancer/` 目录，用 vitest 为纯逻辑函数编写单元测试：`getFps` fallback 逻辑、`stepFrames` clamp 边界、`t()` 语言回退、OSD value clamp
- [ ] T031 在 jellyfin-dev 容器上手动验收全部 5 个用户故事（完整 E2E 检查清单）：帧步进精度、截图含/不含字幕、移动端双击三区域、滑动亮度/音量、注入管理 UI
- [ ] T032 [P] 更新 `specs/005-player-enhancer/checklists/requirements.md`，将所有验收项标记完成

---

## Dependencies & Execution Order

### Phase 依赖关系

```
Phase 0 (改名) ← 必须最先完成
    └─→ Phase 1 (Setup)
    └─→ Phase 2 (Foundation) ← 阻塞所有 US
            ├─→ Phase 3 (US1 帧步进) P1 🎯 MVP
            ├─→ Phase 4 (US2 截图)   P2
            ├─→ Phase 5 (US3 双击)   P3
            │       └─→ Phase 6 (US4 滑动) P4  ← 复用 gestures.ts
            └─→ Phase 7 (US5 管理UI) P5
                    └─→ Phase 8 (Polish)
```

### US 间依赖

- **US1 (P1)**: Phase 2 完成后即可开始，无 US 间依赖
- **US2 (P2)**: Phase 2 完成后即可开始，无 US 间依赖
- **US3 (P3)**: Phase 2 完成后即可开始，创建 `gestures.ts` 和 `osd-overlay.ts`
- **US4 (P4)**: 依赖 US3（扩展 `gestures.ts` 和 `osd-overlay.ts`，非阻塞性扩展）
- **US5 (P5)**: Phase 2 完成后即可开始，依赖 T010 的 EntryPoint（Phase 2 中完成）

### 文件内并发

- T006 / T007 / T008 / T009 可并行（不同文件）
- T013 / T016 可并行（不同文件）
- T018 / T019 可并行（不同文件）
- T024 / T025 可并行（C# vs TS，不同语言不同项目）
- T029 / T030 / T031 / T032 可并行

---

## Parallel Example: Phase 2 Foundation

```
同时启动：
  Task T007: src/player-enhancer/src/i18n.ts
  Task T008: src/player-enhancer/src/icons.ts
  Task T009: src/player-enhancer/src/styles.ts

然后串行：
  Task T006: src/player-enhancer/src/types/jellyfin.ts
  Task T010: PlayerEnhancerEntryPoint.cs
  Task T011: src/player-enhancer/src/injector.ts（依赖 T006）
  Task T012: src/player-enhancer/src/index.ts（依赖 T011）
```

---

## Implementation Strategy

### MVP（仅 US1 帧步进）

1. Phase 0: 改名（R001–R011）
2. Phase 1: Setup → Phase 2: Foundation
2. Phase 3: US1 帧步进
3. **STOP & VALIDATE**: 验证帧步进独立可用
4. Deploy 到 jellyfin-dev 演示

### Incremental Delivery

```
Phase 1+2 → Foundation ready
Phase 3   → US1 帧步进（MVP，已可发布 alpha）
Phase 4   → US2 截图（含字幕 Switch）
Phase 5   → US3 移动端双击
Phase 6   → US4 移动端滑动
Phase 7   → US5 注入管理 UI
Phase 8   → Polish + tests + release
```

---

## Notes

- `[P]` = 可与同阶段其他 `[P]` 任务并行（不同文件）
- Phase 0（R001–R015）为完整改名，包含目录、AssemblyName、命名空间、API 路由、CSS 前缀、localStorage key、DB 文件名；R001–R014 已完成，R015（gh repo rename）待合并 main 后执行
- Phase 0 含向后兼容迁移：DB（VACUUM INTO）、settings localStorage、poster localStorage、unlock localStorage
- `[USn]` = 所属用户故事，用于追踪 spec 验收
- Phase 2 完成前不得开始任何 US 工作
- US3 和 US4 共用 `gestures.ts` 和 `osd-overlay.ts`，US4 是对这两个文件的**扩展**而非重写
- 每个 Phase 完成后在 jellyfin-dev 容器验证 checkpoint
