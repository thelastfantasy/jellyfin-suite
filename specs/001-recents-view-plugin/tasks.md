# Tasks: Jellyfin 最近播放视图插件

**Input**: Design documents from `specs/001-recents-view-plugin/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/plugin-api.md ✓

**Tests**: 仅对核心纯逻辑（分组/排序/日期工具）生成单元测试任务；E2E 测试通过手动验证。

**Organization**: 按 User Story 分阶段，每阶段可独立实现和验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无未完成依赖）
- **[Story]**: 对应 spec.md 中的用户故事编号

---

## Phase 1: Setup（项目初始化）

**Purpose**: 创建完整项目骨架、工具链配置、开发环境设置

- [ ] T001 创建仓库目录结构（`src/JellyfinRecents.Plugin/`、`src/frontend/`、`tests/JellyfinRecents.Tests/`、`tests/frontend/`、`.github/workflows/`）
- [ ] T002 创建 .NET 解决方案文件 `jellyfin-recents.sln` 并添加 C# 项目引用
- [ ] T003 [P] 初始化 C# 插件项目 `src/JellyfinRecents.Plugin/JellyfinRecents.Plugin.csproj`（目标框架 net8.0，引用 Jellyfin.Controller NuGet 包）
- [ ] T004 [P] 初始化 TypeScript 前端项目 `src/frontend/package.json`（依赖：preact、@jellyfin/sdk；devDependencies：vite、vitest、typescript）
- [ ] T005 配置 Vite 构建 `src/frontend/vite.config.ts`（输出格式 iife，输出路径指向 `src/JellyfinRecents.Plugin/Web/jellyfin-recents.js`）
- [ ] T006 [P] 配置 TypeScript `src/frontend/tsconfig.json`（target ES2020，JSX preact）
- [ ] T007 [P] 配置 Vitest `src/frontend/vite.config.ts`（在同一文件的 test 块中添加 Vitest 配置）
- [ ] T008 [P] 初始化 xUnit 测试项目 `tests/JellyfinRecents.Tests/JellyfinRecents.Tests.csproj`（引用主项目 + xUnit + Moq）
- [ ] T009 配置 C# post-build 事件 `src/JellyfinRecents.Plugin/JellyfinRecents.Plugin.csproj`（读取环境变量 `JELLYFIN_PLUGINS_PATH`，构建后自动复制 DLL 到本地 Jellyfin 插件目录）
- [ ] T010 [P] 创建 `.env.example` 文件（说明 `JELLYFIN_PLUGINS_PATH` 和 Vite proxy 目标 `VITE_JELLYFIN_URL` 的配置方式）

**Checkpoint**: 项目结构完整，`dotnet build` 和 `npm run build` 均可无错执行

---

## Phase 2: Foundational（核心基础，阻塞所有 User Story）

**Purpose**: 插件注册机制、前后端通信基础、共享类型——所有 User Story 依赖此阶段完成

**⚠️ CRITICAL**: 此阶段完成前不得开始任何 User Story 实现

- [ ] T011 生成插件 GUID（使用 `New-Guid`）并实现 `src/JellyfinRecents.Plugin/Plugin.cs`（继承 `BasePlugin<PluginConfiguration>`，实现 `IHasWebPages`，在 `GetPages()` 中注册配置页面，嵌入资源路径 `JellyfinRecents.Plugin.Web.config.html`）
- [ ] T012 [P] 实现 `src/JellyfinRecents.Plugin/PluginServiceRegistrator.cs`（实现 `IPluginServiceRegistrator`，注册 `PlayHistoryService` 为 Scoped 服务）
- [ ] T013 [P] 实现 `src/JellyfinRecents.Plugin/Configuration/PluginConfiguration.cs`（空配置类，继承 `BasePluginConfiguration`）
- [ ] T014 创建 `src/JellyfinRecents.Plugin/Web/config.html`（设为嵌入资源；引入 `jellyfin-recents.js`；检查 `window.ApiClient` 是否存在，不存在时显示"请从 Jellyfin Web 访问"提示）
- [ ] T015 [P] 实现前端共享类型 `src/frontend/src/types.ts`（导出 `PlayRecord`、`ViewSettings`、`GroupedPage`、`TimeGroup`、`GroupByMode`、`SortByMode`、`MediaFilter` 接口/类型，与 data-model.md 保持一致）
- [ ] T016 [P] 实现 `src/frontend/src/api/jellyfinClient.ts`（从 `window.ApiClient` 提取 serverAddress、accessToken、userId，初始化 `@jellyfin/sdk` 的 `Api` 实例并导出）
- [ ] T017 [P] 实现 `src/frontend/src/state/viewSettings.ts`（从 localStorage 读写 `ViewSettings`，key 为 `jellyfin-recents-settings`，提供默认值：groupBy=week、sortBy=playedDate、mediaFilter=video、showRepeats=false）
- [ ] T018 实现前端入口 `src/frontend/src/main.tsx`（挂载 Preact `App` 组件到 `config.html` 中的挂载点；初始化时调用 `viewSettings.ts` 加载已保存设置）

**Checkpoint**: C# 插件可编译并加载到 Jellyfin，`/web/configurationpage?name=JellyfinRecents` 可访问，显示空白占位页面

---

## Phase 3: User Story 1 - 浏览最近播放记录（默认视图）(Priority: P1) 🎯 MVP

**Goal**: 用户打开插件页面后，看到按周分组的最近 13 周视频播放记录，每条显示缩略图、标题、播放时间

**Independent Test**: 登录 Jellyfin Web → 进入插件配置页 → 确认显示按周分组的播放记录，每条有缩略图、标题和播放时间，有翻页控件

### 前端核心逻辑（单元测试）

- [ ] T019 [P] [US1] 实现 `src/frontend/src/grouping/dateUtils.ts`（实现：`getWeekWindow(pageIndex)` 返回 13 周时间窗口的 start/end；`getWeekLabel(date)` 生成"2026年第X周 (M月D日-M月D日)"格式标签；跨年周以起始日所在年份归属）
- [ ] T020 [P] [US1] 为 dateUtils 编写单元测试 `tests/frontend/dateUtils.test.ts`（覆盖：周标签格式、跨年周归属、窗口边界计算）

### 前端 API 与分组

- [ ] T021 [US1] 实现 `src/frontend/src/api/itemsApi.ts`（封装 `getItemsApi(api).getItems()`：参数固定 `filters=IsPlayed`、`sortBy=DatePlayed`、`sortOrder=Descending`、`recursive=true`、`fields=DateCreated,UserData`；支持 `includeItemTypes`、`startDate`、`endDate` 参数；将响应映射为 `PlayRecord[]`）
- [ ] T022 [US1] 实现 `src/frontend/src/grouping/groupBy.ts`（实现 `groupByWeek(records: PlayRecord[]): TimeGroup[]`；按 `playedDate` 所在周分组；空周跳过）
- [ ] T023 [P] [US1] 为 groupBy 编写单元测试 `tests/frontend/groupBy.test.ts`（覆盖：按周分组正确性、空组跳过、同周多条目）

### 前端 UI 组件

- [ ] T024 [P] [US1] 实现 `src/frontend/src/components/PlayRecordCard.tsx`（显示缩略图 `/Items/{itemId}/Images/Primary?maxWidth=320`、标题、播放时间（独占一行，格式"2026年5月9日 14:30"）；缩略图加载失败时显示占位符）
- [ ] T025 [P] [US1] 实现 `src/frontend/src/components/GroupSection.tsx`（接收 `TimeGroup` prop；渲染组标题 + `PlayRecordCard` 列表；空组不渲染）
- [ ] T026 [P] [US1] 实现 `src/frontend/src/components/Pagination.tsx`（接收 `pageIndex`、`totalPages`、`onPageChange`；渲染上一页/下一页按钮；第 0 页禁用上一页）
- [ ] T027 [US1] 实现 `src/frontend/src/components/Toolbar.tsx`（初版：仅渲染分组、排序、过滤控件的占位（disabled 状态），后续 US 逐步激活）
- [ ] T028 [US1] 实现 `src/frontend/src/components/App.tsx`（管理 `ViewSettings` 状态、`pageIndex`、`records` 数据；挂载时调用 `itemsApi` 获取当前周窗口数据；调用 `groupByWeek` 分组；渲染 Toolbar + 分组列表 + Pagination；显示加载中和空状态）

**Checkpoint**: MVP 完整可用——进入插件页面能看到按周分组的播放记录，有翻页

---

## Phase 4: User Story 2 - 切换分组方式 (Priority: P2)

**Goal**: 用户可在天/周/月/季度/年之间切换分组，标签格式和分页范围随之变化

**Independent Test**: 依次选择 5 种分组方式，确认标签格式正确（含季节名称）、分页范围符合规则

### 扩展分组逻辑

- [ ] T029 [US2] 扩展 `src/frontend/src/grouping/dateUtils.ts`（新增：所有 5 种模式的窗口计算函数 `getWindowByMode(mode, pageIndex)`；标签生成函数 `getLabelByMode(date, mode)`；季度标签：`{年}年{冬/春/夏/秋}季 ({月}-{月}月)`；月标签：`{年}年{月}月`；年标签：`{年}年`；天标签：`{年}年{月}月{日}日`）
- [ ] T030 [US2] 扩展 `src/frontend/src/grouping/groupBy.ts`（新增 `groupByMode(records, mode): TimeGroup[]`，按 `GroupByMode` 分发到对应分组实现；提取公共分组逻辑）
- [ ] T031 [P] [US2] 扩展单元测试 `tests/frontend/groupBy.test.ts`（补充：5 种分组模式覆盖；季度标签验证"2026年春季 (4-6月)"；跨年周归属；空组跳过）
- [ ] T032 [P] [US2] 扩展单元测试 `tests/frontend/dateUtils.test.ts`（补充：所有模式窗口边界；季度计算正确性；跨年边界）

### 前端 UI 激活

- [ ] T033 [US2] 激活 `src/frontend/src/components/Toolbar.tsx` 中的分组选择器（渲染 5 个选项的下拉或按钮组；选择时调用 `onGroupByChange` 回调；重置 `pageIndex` 为 0）
- [ ] T034 [US2] 更新 `src/frontend/src/components/App.tsx`（响应 `groupBy` 变化：重新计算窗口、重新获取数据、重新分组；将 `groupBy` 持久化到 `viewSettings`）

**Checkpoint**: 5 种分组均可切换，标签格式和分页范围符合 spec

---

## Phase 5: User Story 3 - 切换排序方式 (Priority: P2)

**Goal**: 用户可在 5 种排序维度间切换，同一分组内条目顺序随之变化

**Independent Test**: 切换每种排序，验证同一周组内条目按正确字段重排（含收藏优先布尔排序）

- [ ] T035 [US3] 实现 `src/frontend/src/sorting/sortBy.ts`（实现 `sortRecords(records, sortBy, sortOrder): PlayRecord[]`；支持：`title`（字母序）、`playedDate`、`favorite`（isFavorite desc 为主，playedDate desc 为次级）、`releaseYear`（null 排末尾）、`addedDate`（null 排末尾））
- [ ] T036 [P] [US3] 编写单元测试 `tests/frontend/sortBy.test.ts`（覆盖：5 种排序模式；null 值末尾处理；收藏优先的次级排序）
- [ ] T037 [US3] 激活 `src/frontend/src/components/Toolbar.tsx` 中的排序选择器（渲染排序字段下拉 + 升降序切换按钮）
- [ ] T038 [US3] 更新 `src/frontend/src/components/App.tsx`（在分组后对每个 `TimeGroup.records` 调用 `sortRecords`；响应 `sortBy`/`sortOrder` 变化重排；持久化到 `viewSettings`）

**Checkpoint**: 所有排序方式可切换，分组内顺序正确

---

## Phase 6: User Story 5 - 插件发布与第三方仓库 (Priority: P2)

**Goal**: 通过标准 Jellyfin 第三方仓库机制发布插件，用户添加 manifest URL 即可安装和更新

**Independent Test**: 在全新 Jellyfin 实例添加仓库 URL，确认插件出现在目录并可安装

- [ ] T039 在 `src/JellyfinRecents.Plugin/Plugin.cs` 中确认插件元数据完整（Name、Description、Id（GUID）、Version 均正确赋值，Version 格式为四段式）
- [ ] T040 [P] 创建 `manifest.json` 初始版本（放于仓库根目录，包含正确 GUID、name、description、owner、category；versions 数组留空待 CI 填充）
- [ ] T041 [P] 创建 `.github/workflows/build.yml`（触发：push/PR；步骤：`dotnet build`、`dotnet test`、`npm ci && npm run build`、`npx vitest run`）
- [ ] T042 创建 `.github/workflows/release.yml`（触发：push tag `v*.*.*`；步骤：① `npm run build`；② `dotnet publish -c Release`；③ 打包 DLL + meta.json 为 zip；④ 计算 MD5；⑤ 创建 GitHub Release 并上传 zip；⑥ 更新 `manifest.json` 追加新版本条目；⑦ 推送 `manifest.json` 更新到 `gh-pages` 分支）
- [ ] T043 创建插件包元数据文件 `src/JellyfinRecents.Plugin/meta.json`（供打包用：包含 name、guid、version 占位，由 CI 在发布时替换）
- [ ] T044 [P] 在 GitHub 仓库设置中启用 GitHub Pages（源：`gh-pages` 分支根目录；确认 `manifest.json` 可通过 `https://thelastfantasy.github.io/jellyfin-recents/manifest.json` 访问——此步骤为手动操作，在任务中记录操作指引）

**Checkpoint**: push tag 后 CI 自动发布 Release，manifest.json 更新，Jellyfin 可通过仓库 URL 安装插件

---

## Phase 7: User Story 4 - 重复条目显示开关 (Priority: P3)

**Goal**: 开启开关时显示同一媒体的每次播放记录（含时间），关闭时每分组内每媒体只显示最后一次

**Independent Test**: 账号有同一视频多次播放记录，开关开启时显示多条，关闭时显示一条

### C# 后端（Activity Log 封装）

- [ ] T045 实现 `src/JellyfinRecents.Plugin/Models/PlayHistoryEntry.cs`（DTO：`ItemId`、`PlayedDate`）和响应体 `PlayHistoryResponse`（`Entries: List<PlayHistoryEntry>`、`TotalCount: int`）
- [ ] T046 实现 `src/JellyfinRecents.Plugin/Services/PlayHistoryService.cs`（注入 `IActivityManager`；实现 `GetPlayHistoryAsync(userId, startDate?, endDate?, mediaType?)`：查询 Activity Log，过滤 `VideoPlayback`/`AudioPlayback` 类型，仅返回请求用户的记录，映射为 `PlayHistoryEntry` 列表）
- [ ] T047 [P] 编写单元测试 `tests/JellyfinRecents.Tests/PlayHistoryServiceTests.cs`（Mock `IActivityManager`；覆盖：正常返回、过滤其他用户记录、mediaType 过滤、空结果）
- [ ] T048 实现 `src/JellyfinRecents.Plugin/Controllers/PlayHistoryController.cs`（`[Authorize]` 标注；`GET /JellyfinRecents/PlayHistory`；从 JWT/HttpContext 获取当前 userId；调用 `PlayHistoryService`；返回 `PlayHistoryResponse`；处理 401 和 500）

### 前端集成

- [ ] T049 实现 `src/frontend/src/api/historyApi.ts`（调用 `GET /JellyfinRecents/PlayHistory`，携带 Bearer Token；支持 `startDate`、`endDate`、`mediaType` 参数；将响应映射为 `PlayRecord[]`，每个 entry 对应一条独立 `PlayRecord`）
- [ ] T050 扩展 `src/frontend/src/grouping/groupBy.ts`（实现去重逻辑：`deduplicateGroup(group: TimeGroup): TimeGroup`，同一 `itemId` 保留 `playedDate` 最大的一条；仅在 `showRepeats=false` 时调用）
- [ ] T051 激活 `src/frontend/src/components/Toolbar.tsx` 中的重复条目开关（Toggle 控件，显示"显示重复记录"标签）
- [ ] T052 更新 `src/frontend/src/components/App.tsx`（根据 `showRepeats` 切换数据源：false→`itemsApi`，true→`historyApi`；showRepeats=false 时对每组执行去重；持久化到 `viewSettings`）

**Checkpoint**: 开关功能正确，两种模式下同一视频出现次数符合预期

---

## Phase 8: User Story 6 - 视频/音频内容过滤 (Priority: P3)

**Goal**: 默认仅显示视频，可切换至仅音频或全部；"全部"模式下两种类型有视觉区分

**Independent Test**: 账号有视频和音频播放记录，切换过滤选项后列表只含对应类型条目

- [ ] T053 扩展 `src/frontend/src/api/itemsApi.ts`（支持 `mediaFilter: MediaFilter` 参数：video→`includeItemTypes=[Movie,Episode]`；audio→`includeItemTypes=[Audio,MusicVideo]`；all→两组类型合并请求或不限制类型）
- [ ] T054 扩展 `src/frontend/src/api/historyApi.ts`（同上，传递 `mediaType` 参数至后端端点）
- [ ] T055 更新 `src/frontend/src/components/PlayRecordCard.tsx`（在"全部"过滤模式下，在卡片角落显示小图标或标签区分视频/音频类型）
- [ ] T056 激活 `src/frontend/src/components/Toolbar.tsx` 中的内容类型过滤器（三个选项：仅视频/仅音频/全部；默认选中"仅视频"）
- [ ] T057 更新 `src/frontend/src/components/App.tsx`（响应 `mediaFilter` 变化重新获取数据；持久化到 `viewSettings`）

**Checkpoint**: 过滤功能正确，"全部"模式有视觉区分标识

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: 错误处理、样式、可访问性、文档

- [ ] T058 [P] 在 `src/frontend/src/components/App.tsx` 中完善错误处理（API 请求失败时显示错误提示 + 重试按钮；window.ApiClient 不存在时显示引导提示）
- [ ] T059 [P] 在 `src/frontend/src/components/` 所有组件中添加 Jellyfin 深色主题 CSS 变量适配（使用 Jellyfin 已定义的 CSS 变量如 `--theme-text-color`、`--card-content-box-css` 等，确保视觉风格一致）
- [ ] T060 [P] 为 `src/frontend/src/components/Pagination.tsx` 和 `Toolbar.tsx` 添加键盘导航支持（Tab 可聚焦所有控件，Enter/Space 可触发交互）
- [ ] T061 在 `src/JellyfinRecents.Plugin/Services/PlayHistoryService.cs` 中添加基础日志（使用 Jellyfin 的 `ILogger<T>`，记录查询耗时和结果数量）
- [ ] T062 [P] 创建 `README.md`（安装说明：添加仓库 URL 步骤截图引导；手动安装备用方案；开发者本地搭建步骤；`JELLYFIN_PLUGINS_PATH` 配置说明）
- [ ] T063 完善 `manifest.json` 初始发布版本（填写正确的 GUID、description、targetAbi=10.8.0.0；运行 release CI 生成第一个正式版本）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 完成，**阻塞所有 User Story**
- **US1 (Phase 3)**: 依赖 Phase 2，MVP 核心
- **US2 (Phase 4)**: 依赖 Phase 2；依赖 US1 的 `groupBy.ts`、`App.tsx` 骨架
- **US3 (Phase 5)**: 依赖 Phase 2；依赖 US1 的 `App.tsx` 骨架
- **US5 (Phase 6)**: 依赖 Phase 1（需要项目可构建）；可与 US2/US3 并行
- **US4 (Phase 7)**: 依赖 Phase 2 + US1（需要 App.tsx 数据流骨架）
- **US6 (Phase 8)**: 依赖 US1 的 `itemsApi.ts`；若 showRepeats 已实现则还依赖 US4 的 `historyApi.ts`
- **Polish (Final)**: 依赖所有 User Story 完成

### User Story Dependencies

- **US1 (P1)**: 仅依赖 Foundational — 可独立实现和验证
- **US2 (P2)**: 依赖 US1 骨架（`groupBy.ts`、`App.tsx`）— 在 US1 基础上扩展
- **US3 (P2)**: 依赖 US1 骨架（`App.tsx`）— 可与 US2 并行（不同文件）
- **US5 (P2)**: 依赖项目可构建 — 可与 US2/US3 并行
- **US4 (P3)**: 依赖 US1 完整数据流 — 须在 US1 后进行
- **US6 (P3)**: 依赖 US1 的 API 层 — 须在 US1 后进行，可与 US4 并行

### Parallel Opportunities（Phase 2 完成后）

```
US2 (分组切换) ──┐
US3 (排序切换) ──┤── 可同时进行（文件无冲突）
US5 (发布机制) ──┘

US4 (重复条目) ──┐── US1 之后，可同时进行
US6 (类型过滤) ──┘
```

---

## Parallel Examples

### Phase 3: US1 内部并行任务

```
T019 dateUtils.ts (周窗口/标签) ──┐
T020 dateUtils.test.ts           ──┤── 同时执行
T023 groupBy.test.ts             ──┤
T024 PlayRecordCard.tsx          ──┤
T025 GroupSection.tsx            ──┤
T026 Pagination.tsx              ──┘
     ↓（上述完成后）
T021 itemsApi.ts → T022 groupBy.ts → T027 Toolbar.tsx → T028 App.tsx
```

### Phase 2 内部并行任务

```
T012 PluginServiceRegistrator.cs ──┐
T013 PluginConfiguration.cs      ──┤── 同时执行（均不依赖对方）
T015 types.ts                    ──┤
T016 jellyfinClient.ts           ──┤
T017 viewSettings.ts             ──┘
     ↓
T011 Plugin.cs → T014 config.html → T018 main.tsx
```

---

## Implementation Strategy

### MVP First（仅 US1）

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational（阻塞节点）
3. 完成 Phase 3: User Story 1
4. **STOP & VALIDATE**: 进入插件页面，确认按周分组的播放记录正常显示
5. 可选：先发布 Phase 6（US5）让插件可通过仓库安装，再继续后续功能

### Incremental Delivery

1. Setup + Foundational → 基础就绪
2. US1 → 核心视图可用（MVP）
3. US2 + US3（可并行）→ 分组/排序可切换
4. US5 → 发布机制就绪，插件可通过仓库安装
5. US4 + US6（可并行）→ 重复条目 + 类型过滤
6. Polish → 打磨体验，正式发布 v1.0

---

## Notes

- [P] 任务 = 不同文件，无未完成依赖，可并行
- [Story] 标签用于追溯任务对应的用户故事
- 每个 User Story 阶段完成后，该故事应可独立验证
- 插件 GUID（T011 生成）一旦确定**永不更改**
- `JELLYFIN_PLUGINS_PATH` 环境变量不提交到 Git，各开发者本地配置
- T044（GitHub Pages 设置）为手动操作步骤，不可由 CI 自动完成
