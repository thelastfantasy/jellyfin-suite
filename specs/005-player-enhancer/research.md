# Research: Web Player Enhancer

## D1: ESM 全局注入机制

**Decision**: 利用 Jellyfin `config.json` 的 `plugins` 数组，在服务启动时自动添加 enhancer ESM URL  
**Rationale**: Jellyfin 在每次页面加载时 `fetch('/web/config.json', { cache: 'no-store' })`，对数组中每条记录调用 `import(url)` 并实例化 `new Module.default({ playbackManager, events, ... })`。这是官方支持的插件加载路径，无需 hack，且 `playbackManager` 通过构造函数依赖注入，不需要 `__webpack_require__` 搜索。  
**Alternatives considered**:
- File Transformation 插件（运行时 HTTP 拦截）：功能更强，但要求用户额外安装第三方依赖，增加安装门槛
- 直接修改 `index.html`：更脆弱，Jellyfin 升级后即失效且不自动恢复
- `window[name]` 预注册：需要 IIFE bundle 先加载，无法保证全局加载时机

**Jellyfin pluginManager 加载流程**（来自 `src/components/pluginManager.js`）：
```js
// config.json 中的每个字符串条目
// 1. 若 window[spec] 存在 → 作为工厂函数调用
// 2. 否则 → import(spec) 动态加载 ESM 模块
// 3. new Module.default({ playbackManager, events, appRouter, ... })
```

**ESM 入口需符合的契约**：
```ts
export default class PlayerEnhancerPlugin {
  constructor({ playbackManager, events }: JellyfinPluginDeps) { ... }
}
```

---

## D2: C# config.json 修补器

**Decision**: 实现 `IHostedService`（与 `FavoriteEntryPoint` 相同模式），在 `StartAsync()` 中修补 config.json  
**Rationale**: `IHostedService.StartAsync()` 在 Jellyfin 服务器每次启动时调用，天然支持"Jellyfin 升级覆盖 config.json 后自动修复"的需求。  
**Web 目录路径**: 通过 `IApplicationPaths.WebPath` 获取（与 `IApplicationPaths` 注入方式相同，项目已有使用）。

```csharp
// 注入 IApplicationPaths
var configPath = Path.Combine(_appPaths.WebPath, "config.json");
// Read → JSON parse → 检查是否已含 enhancer URL → 若无则 append → Write
```

**幂等性**：每次检查前先搜索是否已存在该 URL，避免重复追加。  
**错误处理**：若 `WebPath` 不可写（极少数裸机部署场景），记录警告日志并跳过，不抛出异常影响服务启动。  
**Alternatives considered**:
- 在 `Plugin.cs` 构造函数中修补：过早，Jellyfin web 服务可能尚未就绪
- API endpoint 手动触发：需要用户操作，违背"全自动"目标

---

## D3: 项目目录结构

**Decision**: `src/player-enhancer/` 作为独立目录，独立 `package.json`，无 monorepo 工具  
**Rationale**: 两个前端包技术栈完全不同（Preact IIFE vs 原生 TypeScript ESM），几乎无共享代码（enhancer 不使用 recents UI 的任何组件）。Makefile 协调两个包的构建，足够简单。  
**共享代码处理**: enhancer 需要的 Jellyfin API 类型（`MediaStream`、`MediaSource` 等）直接在 `player-enhancer/src/types/jellyfin.ts` 中定义为精简 interface，不跨包引用，避免耦合。  
**Alternatives considered**:
- pnpm workspaces monorepo：共享代码量太少（2-3 个 interface），不值得引入 workspace 工具链开销
- 单包双 Vite config：混合 Preact 和原生 TS 在同一包中，`node_modules` 污染，且在概念上不清晰

---

## D4: 帧率获取

**Decision**: 通过 `window.ApiClient.getJSON()` 调用 `GET /Items/{itemId}` 获取，取 `MediaSources[0].MediaStreams` 中 `Type === 'Video'` 的 `RealFrameRate` 字段  
**Rationale**: `ApiClient` 在 Jellyfin web 全局可用，`/Items/{id}` 端点返回完整媒体信息包含帧率，单次调用即可。  
**缓存策略**: 以 `itemId` 为 key 在内存中缓存 fps，避免每次步进都发起 API 请求。  
**Fallback**: `RealFrameRate ?? AverageFrameRate ?? 24`，24fps 覆盖绝大多数影视内容。  
**Alternatives considered**:
- `POST /Items/{id}/PlaybackInfo`：返回更多信息但需要 `PlaybackInfoDto` body，过于复杂
- `video.webkitDecodedFrameCount` 轮询推算：不稳定，需要两个时间点采样，精度差

---

## D5: 触控手势架构

**Decision**: 使用 `touchend`（double-tap）和 `touchmove`（swipe）事件，均以 `capture: true` + `passive: false` 注册  
**移动端检测**: `navigator.maxTouchPoints > 0`（不用 UA sniffing，Chrome DevTools 设备模式可正确模拟）

**双击检测逻辑**:
```
touchend → 记录时间戳和 x 坐标
若距上次 touchend < 300ms 且 x 坐标侧别相同 → 触发快进/快退
同时调用 preventDefault() 阻止 Jellyfin 的单击 OSD 切换
```

**滑动检测逻辑**:
```
touchstart → 记录 startY、startValue（当前音量/亮度）、side（左/右半屏）
touchmove  → deltaY = startY - currentY；归一化为 0-1；更新 volume/brightness
           → preventDefault() 阻止页面滚动和 OSD 交互
touchend   → 重置状态，隐藏 OSD 指示器（延迟 1.5s）
```

**事件冲突优先级**:
1. 滑动手势 > OSD 显示/隐藏（`capture: true` 先拦截）
2. 双击手势中，若第二次 tap 落在 OSD 按钮上 → 按钮的 `click` 优先（不阻止 click 事件）

**Alternatives considered**:
- Pointer Events API：兼容性更好但 Jellyfin 自身用 touch 事件，统一更安全
- HammerJS：引入 8KB 依赖，本场景手势简单，不值得

---

## D6: 截图实现

**Decision**: Canvas API 合成，仅支持 ASS 字幕叠加（`v1`）

**流程**:
```
1. videoEl = document.querySelector('video.htmlvideoplayer')
2. canvas(videoEl.videoWidth × videoEl.videoHeight)
3. ctx.drawImage(videoEl, 0, 0)
4. 若 includeSubtitles：
     assCanvas = document.querySelector('.libassjs-canvas-parent canvas')
     若存在 → ctx.drawImage(assCanvas, 0, 0, w, h)
5. canvas.toBlob(blob => download PNG)
6. DRM 检测：catch SecurityError → 显示提示，不产生空白图片
```

**SRT DOM 字幕**（`div.videoSubtitles`）：v1 跳过，因为需要 `html2canvas` 或手动 DOM → canvas 绘制，复杂度高且收益低（ASS 是主流字幕格式）。  
**文件名**: `jellyfin-screenshot-{itemTitle}-{timestamp}.png`

---

## D7: CSS 注入方式（ESM bundle）

**Decision**: 在 plugin 构造函数中以 JS 创建并追加 `<style>` 元素  
**Rationale**: ESM format 不支持 IIFE bundle 的 `inlineCssPlugin` trick；动态插入 `<style>` 是标准 Web Component 和 micro-frontend 做法。  
**样式隔离**: 所有选择器以 `.jr-enhancer-` 前缀，避免污染 Jellyfin 原有样式。

---

## D8: OSD 注入位置确认

**Decision**: 将按钮容器 `insertBefore` 到 `.osdControls .buttons.focuscontainer-x` 的首个子元素之前，或 `appendChild` 到该容器末尾

**来自 Jellyfin web 源码的实际 selector**：
- `video.htmlvideoplayer` — `<video>` 元素
- `.videoPlayerContainer` — 全屏播放容器（MutationObserver 的观察目标）
- `.osdControls .buttons.focuscontainer-x` — 底部按钮行（帧步进/截图按钮注入位置）
- `.libassjs-canvas-parent canvas` — ASS 字幕 canvas
- `div.videoSubtitles` — SRT 字幕 DOM 容器

**MutationObserver 触发条件**: 监听 `document.body` 的 childList，检测 `.videoPlayerContainer` 出现；同时监听 `playbackstart` 事件作为二次保障。
