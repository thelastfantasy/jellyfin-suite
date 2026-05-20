# Feature Specification: Home Tab Injection

**Feature Branch**: `feat/home-tab-injection`
**Created**: 2026-05-19
**Revised**: 2026-05-20
**Status**: Spec (implementation deferred)

---

## Background

Jellyfin 主页顶部有一个 tab 栏（Home / Favorites），是用户最直接的导航入口。插件的"最近播放"视图目前只能通过插件配置页访问，路径深、移动端尤其不便。

目标：将完整的最近播放视图作为主页的第三个原生 tab 面板注入，让用户无需离开主页即可查看历史记录——与 Home / Favorites 并列，行为一致。

---

## 范围

### Home Tab 包含的功能（与插件配置页保持一致）

- 分组浏览（日 / 周 / 月 / 季 / 年）
- 排序（播放时间、标题、发行日期、添加日期、收藏优先）
- 媒体筛选（全部 / 视频 / 音频）
- 去重模式（全局去重 + 分组内去重）
- 剧集信息（系列名称 + 集数代码）
- 智能链接（系列名 → 作品页，集标题 → 剧集页）
- 文件夹视图
- 视图模式（缩略图 / 海报 / 列表）
- 完整分页
- 多语言（en / zh / ja）

### Home Tab **不包含**的功能

- 播放器增强相关设置（帧步进、截图、手势配置）——这些属于 player-enhancer

### 插件配置页新增内容

- Home Tab 注入开关（enable / disable），默认启用
- 其余最近播放设置（分组、排序等）由 home tab 和配置页共享同一套后端配置

---

## 架构决策

### 新建独立 bundle：`src/home-injector/`

Home tab 注入与 player-enhancer 注入目标完全不同（主页 DOM vs 播放器 DOM），独立 bundle 使两者各自专注：

```
src/
  home-injector/       ← 新增
    src/
      index.ts         ← bundle 入口，initHomeInjector()
      home-tab.ts      ← tab 按钮 + panel 注入逻辑
      mount.tsx        ← Preact 挂载到 panel div
    vite.config.ts     ← 独立构建
    tsconfig.json
    package.json
  frontend/            ← 现有，需重构组件导出
  player-enhancer/     ← 不变
```

### Frontend 组件导出重构

`src/frontend/` 目前是自挂载 IIFE，组件不对外导出。需将核心组件和 API 层改为正式导出，以便 home-injector 直接 import：

```
src/frontend/src/
  components/
    RecentlyPlayedView.tsx    ← 导出，home-injector 挂载此组件
    PlayRecordCard.tsx        ← 导出（已是子组件）
    ...
  api/                        ← 全部导出
  i18n/                       ← 全部导出
  index.tsx                   ← 保留，自挂载入口（配置页不变）
```

home-injector 通过 Vite path alias 直接 import frontend/src 下的文件，各自构建独立 bundle，不引入 npm workspace 或发布步骤。

### C# 注入层

新建 `HomeInjectorEntryPoint.cs`（或复用 `PlayerEnhancerEntryPoint.cs`），在 Jellyfin 启动时向 `index.html` 注入第二个 `<script>` 标签：

```html
<script src="/JellyfinSuite/home-injector.js?v={timestamp}" defer></script>
```

### C# 配置

`PluginConfiguration.cs` 新增：
- `public bool HomeTabEnabled { get; set; } = true;`

新增 API 端点（或复用 `PlayerEnhancerController`）：
- `GET /JellyfinSuite/HomeInjectorConfig` → 返回 `{ homeTabEnabled: bool }`
- `POST /JellyfinSuite/HomeInjectorConfig` → 保存配置

---

## Clarifications

- **Tab 形态**：使用 `<button is="emby-button">` 无 href 形式（纯 DOM 切换，URL 不变），tab 面板与 Home / Favorites 并列，不跳转到配置页。
- **数据共享**：home tab 和配置页使用同一套 `/JellyfinRecents/PlayHistory` 端点和后端配置，无需独立数据模型。
- **幂等注入**：MutationObserver 监听主页 DOM 出现，通过 `data-jfs-hometab` 标记防止重复注入；主页离开后 tab 销毁，回来后重新注入。
- **配置页不变**：`src/frontend/` 的配置页外观、功能、路由均不受影响；组件导出重构只是增加 export，不改变现有行为。
- **选择器失效**：找不到 `.tabs-viewmenubar .emby-tabs-slider` 时静默跳过，不影响 player-enhancer。
- **禁用时**：`HomeTabEnabled = false` → home-injector bundle 加载后直接返回，不注入任何 DOM。
- **状态隔离**：home tab 和配置页各自维护自己的 UI 状态（当前页、选中分组等），互不干扰。

---

## User Stories & Acceptance Scenarios

### Story 1 — 主页 Tab 面板（P1）

**Given** 用户在 Jellyfin 主页，**When** 页面渲染完成，**Then** 顶部 tab 栏末尾出现"Recently Played / 最近播放 / 最近再生"tab。

**Given** 用户点击该 tab，**When** 面板激活，**Then** URL 不变，面板内显示完整的最近播放视图（卡片、分组、分页）。

**Given** 用户切换回 Home tab，**When** 再次点击 Recently Played tab，**Then** 视图状态保持（不重置到第一页）。

**Given** 用户从主页导航到其他页面再返回，**When** 主页重新渲染，**Then** tab 重新出现且只出现一次。

### Story 2 — 功能完整性（P1）

**Given** home tab 面板已激活，**Then** 以下功能与插件配置页行为一致：分组 / 排序 / 媒体筛选切换、去重模式切换、视图模式切换、翻页、卡片点击跳转。

### Story 3 — 插件配置页新增开关（P2）

**Given** 用户在插件配置页，**Then** 能看到"Home Tab 注入"开关（默认启用）。

**Given** 用户关闭开关并保存，**When** 刷新主页，**Then** Recently Played tab 不再出现。

### Story 4 — 配置页样式不变（P1，回归）

**Given** home-injector 和 frontend 重构后，**Then** 插件配置页的所有功能和样式与重构前完全一致。
