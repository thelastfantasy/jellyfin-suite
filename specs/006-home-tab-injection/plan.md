# Implementation Plan: Home Tab Injection

**Feature**: 006-home-tab-injection
**Branch**: `feat/home-tab-injection`
**Revised**: 2026-05-20

---

## 架构总览

```
src/
  frontend/              ← 现有，仅增加组件 export，IIFE 入口不变
    src/
      components/        ← 各组件加 export（不改内部逻辑）
      api/               ← 已是 export，确认可直接引用
      i18n/              ← 已是 export
      index.tsx          ← 不动，配置页自挂载入口
  home-injector/         ← 新增 package
    src/
      index.ts           ← bundle 入口
      home-tab.ts        ← tab 按钮 + panel 注入
      mount.tsx          ← Preact render 到 panel div
    package.json
    tsconfig.json
    vite.config.ts
  player-enhancer/       ← 不动
  JellyfinSuite.Plugin/
    HomeInjectorEntryPoint.cs   ← 新增，注入第二个 <script>
    Configuration/
      PluginConfiguration.cs    ← 新增 HomeTabEnabled
    Controllers/
      HomeInjectorController.cs ← 新增，GET/POST HomeInjectorConfig
    Web/
      home-injector.js          ← 构建产物
```

**核心原则**：frontend 的 IIFE 格式和插件配置页入口完全不变。home-injector 通过 Vite path alias 在**构建时**引用 frontend/src 下的源文件，打出独立的第二个 IIFE bundle，运行时两者互不依赖。

---

## Phase 1：Frontend 组件导出

### 目标

让 home-injector 的 Vite 构建能够 import frontend 的组件和 API，而不改变 frontend 的运行时行为。

### 需要确认/修改的文件

- `src/frontend/src/components/RecentlyPlayedView.tsx`：确认已 export，如未 export 则加上
- `src/frontend/src/components/PlayRecordCard.tsx`、分页组件、筛选组件等：同上
- `src/frontend/src/api/`：确认全部 export
- `src/frontend/src/i18n/`：确认全部 export
- `src/frontend/src/hooks/`（如有）：确认 export

原则：只加 `export`，不改组件内部逻辑，不动 `index.tsx`。

---

## Phase 2：新建 `src/home-injector/` 包

### package.json

```json
{
  "name": "jellyfin-suite-home-injector",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch"
  },
  "devDependencies": {
    "preact": "同 frontend 版本",
    "typescript": "同 frontend 版本",
    "vite": "同 frontend 版本"
  }
}
```

### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'path';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@frontend': path.resolve(__dirname, '../frontend/src'),
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'JfsHomeInjector',
      formats: ['iife'],
      fileName: () => 'home-injector.js',
    },
    outDir: '../JellyfinSuite.Plugin/Web',
    emptyOutDir: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
```

### src/index.ts

```typescript
import { initHomeInjector } from './home-tab';

(async () => {
  try {
    const res = await fetch('/JellyfinSuite/HomeInjectorConfig');
    if (res.ok) {
      const cfg = await res.json() as { homeTabEnabled?: boolean };
      if (cfg.homeTabEnabled === false) return;
    }
  } catch { /* keep default: enabled */ }

  initHomeInjector();
})();
```

### src/home-tab.ts

注入逻辑，复用 research.md 的 DOM 调研结论：

```typescript
import { renderHomeTab } from './mount';

const MARKER = 'data-jfs-hometab';

export function initHomeInjector(): void {
  // 初始尝试
  tryInject();
  // MutationObserver 监听主页 DOM 出现（路由切换后重新渲染）
  const observer = new MutationObserver(tryInject);
  observer.observe(document.body, { childList: true, subtree: true });
}

function tryInject(): void {
  const slider = document.querySelector<HTMLElement>(
    '.tabs-viewmenubar .emby-tabs-slider'
  );
  if (!slider || slider.querySelector(`[${MARKER}]`)) return;

  // Tab 按钮（无 href，纯 DOM 切换，与 Home/Favorites 一致）
  const nextIndex = slider.querySelectorAll('.emby-tab-button').length;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('is', 'emby-button');
  btn.className = 'emby-tab-button emby-button';
  btn.dataset.index = String(nextIndex);
  btn.setAttribute(MARKER, '1');
  btn.innerHTML = `<div class="emby-button-foreground">${getLabel()}</div>`;

  // Tab 面板（.pageTabContent，与 Home/Favorites 并列）
  const panel = document.createElement('div');
  panel.className = 'tabContent pageTabContent';
  panel.dataset.index = String(nextIndex);

  // 挂载 Preact 视图到面板
  renderHomeTab(panel);

  // 注入到 tab 栏和内容区
  slider.appendChild(btn);
  injectPanel(panel);

  // 监听 emby-tabs 的 tabchange 事件，切换 is-active
  const tabsEl = slider.closest('[is="emby-tabs"]');
  tabsEl?.addEventListener('tabchange', (e: Event) => {
    const { selectedTabIndex } = (e as CustomEvent).detail;
    panel.classList.toggle('is-active', selectedTabIndex === nextIndex);
    btn.classList.toggle('emby-tab-button-active', selectedTabIndex === nextIndex);
  });
}

function injectPanel(panel: HTMLElement): void {
  // 注入到 .pageTabContent 的父容器（与现有面板同级）
  const existingPanel = document.querySelector('.tabContent.pageTabContent');
  existingPanel?.parentElement?.appendChild(panel);
}

function getLabel(): string {
  const lang = (document.documentElement.lang || navigator.language || 'en')
    .toLowerCase().split('-')[0];
  if (lang === 'zh') return '最近播放';
  if (lang === 'ja') return '最近再生';
  return 'Recently Played';
}
```

### src/mount.tsx

```typescript
import { render } from 'preact';
import { RecentlyPlayedView } from '@frontend/components/RecentlyPlayedView';

export function renderHomeTab(container: HTMLElement): void {
  render(<RecentlyPlayedView />, container);
}
```

---

## Phase 3：C# 后端

### PluginConfiguration.cs 新增

```csharp
public bool HomeTabEnabled { get; set; } = true;
```

### HomeInjectorController.cs

```csharp
[ApiController]
[Route("JellyfinSuite")]
public class HomeInjectorController : ControllerBase
{
    [HttpGet("HomeInjectorConfig")]
    public IActionResult GetConfig()
    {
        var cfg = Plugin.Instance?.Configuration;
        return Ok(new HomeInjectorConfigDto
        {
            HomeTabEnabled = cfg?.HomeTabEnabled ?? true,
        });
    }

    [HttpPost("HomeInjectorConfig")]
    [Authorize(Policy = "RequiresElevation")]
    public IActionResult SetConfig([FromBody] HomeInjectorConfigDto dto)
    {
        var cfg = Plugin.Instance?.Configuration;
        if (cfg is null) return NotFound();
        cfg.HomeTabEnabled = dto.HomeTabEnabled;
        Plugin.Instance!.SaveConfiguration();
        return NoContent();
    }
}

public sealed class HomeInjectorConfigDto
{
    [JsonPropertyName("homeTabEnabled")]
    public bool HomeTabEnabled { get; set; } = true;
}
```

### HomeInjectorEntryPoint.cs

与 `PlayerEnhancerEntryPoint.cs` 结构相同，在 Jellyfin 启动时向 `index.html` 注入：

```html
<script src="/JellyfinSuite/home-injector.js?v={dll_timestamp}" defer></script>
```

---

## Phase 4：Frontend 配置页新增 Home Tab 开关

在 `src/frontend/src/components/PlayerEnhancerPanel.tsx`（或独立的 `HomeInjectorPanel.tsx`）中新增：

- `homeTabEnabled` 状态，从 `GET /JellyfinSuite/HomeInjectorConfig` 初始化
- 一个 toggle 开关，`POST /JellyfinSuite/HomeInjectorConfig` 保存
- 保存时 dispatch `jfs:homeTabEnabledChanged` 自定义事件（home-injector 监听后动态移除 tab）

---

## Phase 5：构建集成

### Makefile / mise.toml 新增

```makefile
build-home-injector:
    cd src/home-injector && npm install && npm run build

build: build-poster-gen build-frontend build-enhancer build-home-injector
```

`make update` 流程自动包含新 bundle 的构建，无需额外步骤。

---

## 关键风险与缓解

| 风险 | 缓解 |
|------|------|
| frontend 组件有副作用（自执行代码），import 时意外触发 | 仔细审查 Phase 1，只 export 纯组件和函数，不 export 有副作用的模块 |
| `.tabs-viewmenubar` 选择器在未来版本失效 | `tryInject` 找不到节点时静默返回，不报错 |
| `tabchange` 事件 detail 格式变化 | 防御性读取，缺字段时静默忽略 |
| panel 注入位置不对（父容器不固定）| 调研时确认父容器选择器，必要时用多个备选选择器 |
| 两个 bundle 都引用 preact，导致 preact 实例冲突 | 两者在不同页面运行，不存在同页面双实例问题 |
