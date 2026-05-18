# Implementation Plan: Web Player Enhancer

**Branch**: `feature/005-player-enhancer` | **Date**: 2026-05-18 | **Spec**: [spec.md](spec.md)

## Summary

为 Jellyfin Recents 插件添加播放器增强功能：帧步进按钮、截图、移动端双击快进/快退、移动端滑动亮度/音量调节。

技术路线：新建 `src/player-enhancer/` 原生 TypeScript ESM 包，通过 C# `IHostedService` 在服务启动时自动将 ESM bundle URL 追加到 Jellyfin 的 `config.json`，实现全局加载。前端通过 Jellyfin plugin 构造函数依赖注入获得 `playbackManager`，用 `MutationObserver` 检测播放器 DOM 出现后注入 UI。

---

## Technical Context

**Language/Version**: TypeScript 5.x（player-enhancer）、C# / net8.0（插件）  
**Primary Dependencies**: Vite 6.x（ESM build）、Jellyfin Plugin SDK（IHostedService）  
**Storage**: 无新数据库表；仅修补 `config.json` 文件  
**Testing**: vitest（纯逻辑单元测试）、Chrome DevTools 设备模式（手动 touch 测试）、jellyfin-dev 容器（手动 E2E）  
**Target Platform**: Jellyfin 10.10.x；现代浏览器（Chrome/Firefox/Safari）；touch 功能限 iOS/Android  
**Project Type**: Jellyfin 插件扩展（C# 服务 + 全局 ESM web 插件）  
**Performance Goals**: OSD 按钮注入 < 100ms（播放器出现后）；滑动手势响应 < 100ms  
**Constraints**: 无 Preact/React 依赖；ESM bundle 目标 < 30KB；不增加服务端 DB 表  
**Scale/Scope**: 单用户本地插件，无并发要求

---

## Constitution Check

项目 constitution 尚未填写（仍为模板），跳过 gate 检查。

---

## Project Structure

### Documentation (this feature)

```text
specs/005-player-enhancer/
├── plan.md              ← 本文件
├── research.md          ← 技术决策记录（Phase 0）
├── data-model.md        ← 运行时状态与 API 依赖（Phase 1）
└── tasks.md             ← 由 /speckit-tasks 生成
```

### Source Code

```text
src/
├── frontend/                          ← 现有，不变
│   └── src/
│       └── ...（recents UI，Preact IIFE）
│
├── player-enhancer/                   ← 新建独立包
│   ├── src/
│   │   ├── index.ts                   ← ESM 入口：export default class
│   │   ├── injector.ts                ← MutationObserver + DOM 注入逻辑
│   │   ├── framestepper.ts            ← 帧步进按钮 DOM 创建 + 事件
│   │   ├── screenshot.ts              ← Canvas API 截图
│   │   ├── gestures.ts                ← 移动端双击 + 滑动手势
│   │   ├── osd-overlay.ts             ← 亮度/音量 OSD 浮层
│   │   ├── fps-cache.ts               ← 帧率获取与缓存
│   │   ├── icons.ts                   ← SVG 图标字符串常量
│   │   ├── i18n.ts                    ← 轻量 i18n（中/日/英，t() 函数）
│   │   └── types/
│   │       └── jellyfin.ts            ← 精简 Jellyfin 类型 interface
│   ├── vite.config.ts                 ← ESM 格式构建
│   ├── tsconfig.json
│   └── package.json
│
├── frontend/
│   └── src/
│       ├── api/
│       │   └── playerEnhancerApi.ts       ← 新增：注入状态/注入/卸载 API 调用
│       └── components/
│           └── PlayerEnhancerPanel.tsx    ← 新增：注入状态 + 操作按钮（嵌入设置面板）
│
└── JellyfinRecents.Plugin/            ← 现有，小幅扩展
    ├── Plugin.cs                      ← 追加 JellyfinRecentsPlayerEnhancer 页面注册
    ├── PlayerEnhancerEntryPoint.cs    ← 新建：IHostedService，修补 config.json
    ├── Controllers/
    │   └── PlayerEnhancerController.cs   ← 新建：注入状态/注入/卸载 API endpoint
    └── Web/
        ├── config.html                ← 不变
        ├── jellyfin-recents.js        ← 不变（现有 IIFE bundle）
        └── jellyfin-recents-enhancer.js  ← 新增（ESM bundle，构建产物）

tests/
└── player-enhancer/                   ← 新建
    └── *.test.ts                      ← 纯逻辑单元测试（vitest）
```

---

## Pre-Implementation：插件改名（Jellyfin Recents → Jellyfin Suite）

> 此工作在 005 功能实现之前完成，与 005 feature 并列但独立，影响整个插件代码库。

### 改名策略

**只改显示层，保持部署层稳定：**

| 层 | 当前值 | 新值 | 理由 |
|----|--------|------|------|
| Plugin.Name（显示名） | `"Jellyfin Recents"` | `"Jellyfin Suite"` | 改 |
| AssemblyName | `JellyfinRecents.Plugin` | 不变 | 改了会有新旧 DLL 并存风险 |
| 插件文件夹名 | `JellyfinRecents` | 不变 | 同上，Makefile 无需改 |
| Task.Key 前缀 | `"JellyfinRecents."` | 不变 | 改了 ScheduledTasks 历史丢失 |
| DB 文件名 | `jellyfin-recents.db` | 不变 | 改了需数据迁移 |
| 字体目录 | `DataPath/fonts` | 不变 | 通用路径，无关 |
| GitHub repo 名 | `jellyfin-recents` | `jellyfin-suite` | 最后做，代码合并后 |

### 新建 PluginConstants.cs

`src/JellyfinRecents.Plugin/PluginConstants.cs`（集中管理所有插件级字符串常量）：

```csharp
namespace Jellyfin.Plugin.JellyfinRecents;

internal static class PluginConstants
{
    internal const string PluginName        = "Jellyfin Suite";
    internal const string TaskCategory      = PluginName;
    internal const string TaskKeyPrefix     = "JellyfinRecents";     // 向后兼容，不改
    internal const string DatabaseFileName  = "jellyfin-recents.db"; // 向后兼容，不改
    internal const string PosterTempPrefix  = "postersheet-";        // 消除 Service/Task 重复
}
```

### 代码级改动清单

| 文件 | 改动 | 性质 |
|------|------|------|
| `PluginConstants.cs` | **新建** | 增 |
| `Plugin.cs` | `Name` → `PluginConstants.PluginName` | 改 |
| `Plugin.cs` | `Description` 更新 | 改 |
| 6 个 Task 文件 | `Category = "Jellyfin Recents"` → `PluginConstants.TaskCategory` | 改 |
| `CleanPosterSheetsTask.cs` | `private const TempPrefix` → `PluginConstants.PosterTempPrefix` | 改（消除重复） |
| `CleanInvalidRecordsTask.cs` | `Type = "DailyTrigger"` → `TaskTriggerInfo.TriggerDaily` | **修 bug** |
| `PluginServiceRegistrator.cs` | DB 路径字符串 → `PluginConstants.DatabaseFileName` | 改（引用常量） |
| `meta.json` | `name`、`description`、`targetAbi: "10.10.7.0"` | 改 |
| `manifest.json` | 两条 entry 的 `name`、`description`、`overview` | 改 |
| `release.yml` | zip 文件名、bundled jq name、`targetAbi` | 改 |
| `Makefile` | `update` target 补充 cp `meta.json` | **修 bug** |
| `README.md` | 标题、描述 | 改 |
| `README.zh-CN.md` | 标题、描述 | 改 |
| `src/frontend/src/constants.ts` | **新建**，集中管理前端插件名、设备ID、localStorage key | 增 |
| `posterSheetApi.ts`、`PosterSheetSettingsPanel.tsx` | `brandingText` 默认值 → `PLUGIN_NAME` | 改 |
| `jellyfinClient.ts` | `clientInfo.name`、`deviceInfo.id` → 引用常量 | 改 |
| `viewSettings.ts` | `STORAGE_KEY` → 新 key；加一次性 localStorage 迁移 | 改 |
| `PlayRecordCard.tsx`、`styles.css` | 日志前缀、注释 | 改 |

**前端不改的部分（绑定关系）**：
- `/JellyfinRecents/PosterSheet`、`JellyfinRecents/PlayHistory` — 服务端路由（C# Controller 路径），前后端必须一致
- `jellyfinRecentsPage`、`jellyfin-recents-root` — DOM 元素 ID，Jellyfin SPA 路由靠这些 ID
- `JellyfinRecentsBundle` — PluginPageInfo.Name，config.html 中的加载 URL

### GitHub Repo 改名（最后一步）

代码全部合并到 main 后执行：
```bash
gh repo rename jellyfin-suite
```
GitHub 会自动重定向旧 URL。GitHub Pages manifest URL 不受影响（用的是 `${{ github.repository }}` 变量）。

### 不需要迁移的原因

- **插件配置 XML**：`/config/plugins/configurations/` 中没有 JellyfinRecents 文件（PluginConfiguration 是空类，Jellyfin 从未写入）
- **SQLite + 字体 + 临时文件**：路径全部硬编码为通用名，与插件显示名无关
- **ScheduledTask 历史**：保持 Key 前缀不变，历史记录完整保留

---

## Implementation Approach

### 模块 1：C# config.json 修补器

**文件**: `src/JellyfinRecents.Plugin/PlayerEnhancerEntryPoint.cs`

```csharp
public class PlayerEnhancerEntryPoint : IHostedService
{
    private const string EnhancerUrl =
        "/web/configurationpage?name=JellyfinRecentsPlayerEnhancer";

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // 0. 检查用户偏好：若用户已执行"卸载注入"，跳过自动修补
        if (Plugin.Instance?.Configuration.AutoInjectEnabled == false)
        {
            _logger.LogDebug("PlayerEnhancer auto-inject skipped: disabled by user");
            return Task.CompletedTask;
        }
        // 1. 获取 WebPath（通过 IApplicationPaths 注入）
        // 2. 读取 config.json
        // 3. 检查 plugins 数组是否已含 EnhancerUrl
        // 4. 若无 → 追加 → 写回
        // 5. 异常时记录警告，不阻断服务启动
    }
}
```

**`PluginConfiguration.cs` 变更**（现有文件，追加字段）：
```csharp
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// 用户是否允许自动注入 player enhancer。
    /// false 时 StartAsync() 跳过 config.json 修补。
    /// </summary>
    public bool AutoInjectEnabled { get; set; } = true;
}
```

**Plugin.cs 变更**: 追加 `PluginPageInfo` 注册 `jellyfin-recents-enhancer.js`（`EmbeddedResourcePath`，不含 `EnableInMainMenu`）。

---

### 模块 2：ESM 入口与依赖注入

**文件**: `src/player-enhancer/src/index.ts`

```ts
import { initInjector } from './injector';

export default class PlayerEnhancerPlugin {
  constructor({ playbackManager, events }: JellyfinPluginDeps) {
    initInjector(playbackManager, events);
  }
}
```

Jellyfin pluginManager 实例化时注入 `playbackManager` 和 `events`，无需 `__webpack_require__` hack。

---

### 模块 3：播放器 DOM 注入（injector.ts）

**注入时机**（双重保障）：
1. `MutationObserver` 监听 `document.body`，检测 `.videoPlayerContainer` 出现
2. `Events.on(playbackManager, 'playbackstart', ...)` 作为兜底

**注入位置**: `.osdControls .buttons.focuscontainer-x` 内 `prepend` 一个 `<div class="jr-enhancer-buttons">` 容器，包含帧步进 + 截图按钮。

**幂等性**: 检查 `#jr-enhancer-root` 是否已存在，避免重复注入（OSD 可能隐藏后重新显示）。

**CSS 注入**: constructor 首次运行时向 `document.head` 插入 `<style id="jr-enhancer-styles">`，样式全部以 `.jr-enhancer-` 前缀隔离。

---

### 模块 4：帧步进（framestepper.ts + fps-cache.ts）

**SVG 图标**（`icons.ts`中定义为字符串常量）：
- 后退 10 帧：`|◁◁`（两个三角 + 左竖线）
- 后退 1 帧：`|◁`（一个三角 + 左竖线）
- 前进 1 帧：`▷|`（一个三角 + 右竖线）
- 前进 10 帧：`▷▷|`（两个三角 + 右竖线）

**帧步进逻辑**：
```ts
async function stepFrames(videoEl: HTMLVideoElement, delta: number) {
  const fps = await getFps(currentItemId);   // 缓存优先
  if (!videoEl.paused) videoEl.pause();       // 步进前确保暂停
  videoEl.currentTime = clamp(
    videoEl.currentTime + delta / fps,
    0,
    videoEl.duration
  );
}
```

**帧率获取**（`fps-cache.ts`）：
```ts
// GET /Items/{itemId}?fields=MediaStreams
// → MediaSources[0].MediaStreams.find(s => s.Type === 'Video')
// → RealFrameRate ?? AverageFrameRate ?? 24
```

---

### 模块 5：截图（screenshot.ts）

**OSD 按钮布局**：一个截图按钮 `[📷]` + 相邻的字幕 Switch 开关（**默认关闭**）。
Switch 状态**不持久化**——每次播放器初始化重置为关闭，不读写 localStorage。

**字幕渲染路径与可截取性**：

| 字幕类型 | 可截取 | 说明 |
|---|---|---|
| 硬字幕（烧录） | ✅ 自动包含 | 已是视频帧一部分 |
| ASS/SSA（libass canvas） | ✅ `drawImage` 叠加 | `.libassjs-canvas-parent canvas` |
| SRT/VTT（标准浏览器） | ❌ 无法截取 | 原生 `::cue` 渲染，Canvas API 不可访问 |
| PGS（图形字幕） | ⚠️ 待验证 selector | 推测为 canvas，需实机确认 |

"含字幕截图"仅叠加 ASS canvas（v1 范围），SRT/VTT 用户使用"含字幕"按钮时，截图结果与"不含字幕"一致——需在 UI 上说明（tooltip 或提示文字）。

**截图分辨率**：使用 `videoEl.videoWidth × videoEl.videoHeight`（视频流编码分辨率），
与设备 DPR 无关；播放器 CSS 产生的黑边（letterbox）不会进入截图。

```ts
async function takeScreenshot(videoEl: HTMLVideoElement, includeSubtitles: boolean) {
  const { videoWidth: w, videoHeight: h } = videoEl;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;

  try {
    ctx.drawImage(videoEl, 0, 0, w, h);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'SecurityError') {
      showToast('此内容受版权保护，无法截图');
      return;
    }
    throw e;
  }

  if (includeSubtitles) {
    // ASS/SSA：直接叠加 libass canvas
    const assCanvas = document.querySelector<HTMLCanvasElement>(
      '.libassjs-canvas-parent canvas'
    );
    if (assCanvas) ctx.drawImage(assCanvas, 0, 0, w, h);
    // SRT/VTT 原生 ::cue：浏览器限制，无法捕获，静默跳过
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const title = (playbackManager.currentItem()?.Name ?? 'screenshot')
    .replace(/[^\w一-龥-]/g, '_');
  downloadBlob(blob, `jellyfin-screenshot-${title}-${Date.now()}.png`);
}

---

### 模块 6：移动端手势（gestures.ts）

**激活条件**: `navigator.maxTouchPoints > 0`（模块初始化时检查，false 则跳过所有手势注册）

**三区域双击**（事件注册在 `.videoPlayerContainer`，`capture: true`）：
```ts
// touchend handler — 三区域：左 1/3 退、中 1/3 暂停/恢复、右 1/3 进
const now = Date.now();
const x = e.changedTouches[0].clientX;
const W = window.innerWidth;
const zone = x < W / 3 ? 'left' : x < (W * 2) / 3 ? 'center' : 'right';

if (now - lastTap.time < 300 && zone === lastTap.zone) {
  e.stopPropagation();
  e.preventDefault();
  if (zone === 'left')   { videoEl.currentTime -= 10; showRipple('left', '-10s'); }
  if (zone === 'right')  { videoEl.currentTime += 10; showRipple('right', '+10s'); }
  if (zone === 'center') { videoEl.paused ? videoEl.play() : videoEl.pause(); }
}
lastTap = { time: now, zone };
```

**滑动亮度/音量**（`passive: false` 以允许 `preventDefault`）：
```ts
// touchstart：记录初始状态
// touchmove：
const deltaY = state.startY - touch.clientY;
const delta = deltaY / (window.innerHeight * 0.5); // 半屏 = 满量程
if (state.side === 'left') {
  currentBrightness = clamp(state.startBrightness + delta, 0, 2.0);
  videoEl.style.filter = `brightness(${currentBrightness})`;
  showOsd('亮度', Math.round(currentBrightness * 100));
} else {
  videoEl.volume = clamp(state.startVolume + delta, 0, 1);
  showOsd('音量', Math.round(videoEl.volume * 100));
}
```

---

### 模块 7：OSD 浮层（osd-overlay.ts）

**亮度/音量指示器**: 屏幕中央半透明浮层，包含图标 + 进度条 + 百分比数字。  
**Ripple 动画**: 双击时在点击位置出现圆形扩散动画 + 文字（`+10s` / `-10s`）。  
**实现方式**: 纯 DOM + CSS animation（`@keyframes`），不依赖任何框架。

---

### 模块 8：构建配置

**`src/player-enhancer/vite.config.ts`**:
```ts
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'jellyfin-recents-enhancer.js',
    },
    outDir: '../../src/JellyfinRecents.Plugin/Web',
    emptyOutDir: false,
  },
})
```

**Makefile 变更**: `build` target 追加 `cd src/player-enhancer && npm run build`（或 mise 等效命令）。

---

### 模块 8b：i18n（player-enhancer/src/i18n.ts）

player-enhancer 是独立原生 TS 包，无法复用 `src/frontend` 的 Preact i18n context，
自行实现一个轻量 `t()` 函数即可：

```ts
// 语言检测优先级：
// 1. document.documentElement.lang（Jellyfin 页面设置的 HTML lang 属性）
// 2. navigator.language（前缀最优匹配：zh-* → zh，ja-* → ja，其他 → en）
// 3. 默认 'en'

const TRANSLATIONS = {
  en: {
    'framestepper.back10':  'Back 10 frames',
    'framestepper.back1':   'Back 1 frame',
    'framestepper.forward1':'Forward 1 frame',
    'framestepper.forward10':'Forward 10 frames',
    'screenshot.button':    'Screenshot',
    'screenshot.subtitles': 'Include subtitles',
    'screenshot.drm':       'DRM-protected content cannot be captured',
    'osd.brightness':       'Brightness',
    'osd.volume':           'Volume',
    // ...
  },
  zh: { /* 中文 */ },
  ja: { /* 日本語 */ },
} as const;

export function t(key: string): string { ... }
```

**需要翻译的文本范围**：
- 帧步进按钮 tooltip（4条）
- 截图按钮 tooltip + Switch 标签（2条）
- SRT 字幕无法截取的提示文字（1条）
- DRM 保护提示（1条）
- OSD 亮度/音量标签（2条）
- 双击快进/快退 ripple 文字（`+10s` / `-10s` 无需翻译，数字通用）

**`src/frontend` 中的 `PlayerEnhancerPanel.tsx`** 继续使用现有 frontend 的 i18n 系统（`useTranslation` hook），同步新增中/日/英三语翻译 key 到 `src/frontend/src/i18n/locales/{en,zh,ja}.ts`。

---

### 模块 9：注入管理 UI（src/frontend）

**目的**: 让**管理员**在"最近播放"页面的设置面板中手动控制注入状态，作为自动注入的补充。注入管理区域仅对管理员可见（前端判断 `IsAdministrator`），API 加 `[Authorize(Policy = Policies.RequiresElevation)]`。

**C# API endpoint**（`PlayerEnhancerController.cs`）：

```
GET    /JellyfinRecents/PlayerEnhancer/Status
    → { autoInjectEnabled: bool }
    读取 Plugin.Instance.Configuration.AutoInjectEnabled

POST   /JellyfinRecents/PlayerEnhancer/Inject
    → 设置 AutoInjectEnabled = true → SaveConfiguration() → 追加 URL 到 config.json

DELETE /JellyfinRecents/PlayerEnhancer/Inject
    → 设置 AutoInjectEnabled = false → SaveConfiguration() → 从 config.json 移除 URL
```

**状态语义**：`autoInjectEnabled` 是唯一权威状态，不另外读 config.json（config.json 在下次重启时与此状态同步）。

三个操作共享 `PlayerEnhancerConfigPatcher` 静态工具类（供 EntryPoint 和 Controller 共用 config.json 读写逻辑）。

**前端组件**（`PlayerEnhancerPanel.tsx`，嵌入现有 `SettingsPopover` 或作为独立区块）：

```
[ 播放器增强 ]
状态：● 已启用 / ○ 已禁用
[  重新注入  ]  [  卸载注入  ]
提示：重新注入或卸载后需刷新页面生效
```

- `GET Status` 在组件挂载时调用，依据 `autoInjectEnabled` 显示状态
- "重新注入"→ `POST Inject`：启用自动注入偏好并立即写入 config.json（无需等待重启）
- "卸载注入"→ `DELETE Inject`：持久化禁用偏好并立即移除 config.json 条目；此后服务重启不再自动恢复
- 操作成功后重新查询状态刷新显示

---

## 本地调试工作流

1. `cd src/player-enhancer && npx vite build --watch`（watch 模式，自动重建）
2. Chrome DevTools → Sources → **Overrides** → 拦截 `/web/configurationpage?name=JellyfinRecentsPlayerEnhancer` → 用本地构建产物替代
3. 移动端手势：Chrome DevTools → 设备模式，选择 iPhone 等设备（`navigator.maxTouchPoints > 0` 自动激活）
4. C# 变更需 `make update`（重启容器），前端变更仅需刷新浏览器
