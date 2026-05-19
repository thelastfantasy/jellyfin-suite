# Implementation Plan: Home Tab Injection

**Feature**: 006-home-tab-injection
**Branch**: `feat/home-tab-injection`

## Architecture

本功能完全在 player enhancer bundle（`src/player-enhancer/`）内实现，不涉及 C# 后端或前端 React 代码。

```
src/player-enhancer/src/
  home-tab.ts       ← 新增：注入逻辑
  i18n.ts           ← 修改：新增 nav.recentlyPlayed key
  injector.ts       ← 修改：在 MutationObserver 回调中调用 injectHomeTab()
```

## Implementation Details

### home-tab.ts

```typescript
import { t } from './i18n';

const PLUGIN_HASH = '#!/configurationpage?name=JellyfinSuite';

export function injectHomeTab(): void {
  const slider = document.querySelector<HTMLElement>(
    '.tabs-viewmenubar .emby-tabs-slider'
  );
  // 幂等：已注入或找不到目标时静默返回
  if (!slider || slider.querySelector('[data-jfs-tab]')) return;

  const nextIndex = slider.querySelectorAll('.emby-tab-button').length;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('is', 'emby-button');
  btn.className = 'emby-tab-button emby-button';
  btn.dataset.index = String(nextIndex);
  btn.setAttribute('data-jfs-tab', '1');        // 幂等标记
  btn.innerHTML = `<div class="emby-button-foreground">${t('nav.recentlyPlayed')}</div>`;

  btn.addEventListener('click', () => {
    window.location.hash = PLUGIN_HASH;
  });

  slider.appendChild(btn);
}
```

### i18n.ts — 新增 key

```typescript
'nav.recentlyPlayed': 'Recently Played'   // en
'nav.recentlyPlayed': '最近播放'           // zh
'nav.recentlyPlayed': '最近再生'           // ja
```

### injector.ts — 集成调用

在 `initInjector()` 的 `MutationObserver` 回调和初始 `tryInject()` 调用处，追加一次 `injectHomeTab()` 调用：

```typescript
import { injectHomeTab } from './home-tab';

// 现有 observer：
const observer = new MutationObserver(() => {
  tryInject();
  injectHomeTab();   // ← 追加
});
observer.observe(document.body, { childList: true, subtree: true });
tryInject();
injectHomeTab();     // ← 追加
```

## Why This Approach

- **复用 MutationObserver**：player enhancer 已有一个全局 observer，无需再开一个，避免性能开销翻倍。
- **幂等标记 `data-jfs-tab`**：observer 每次 DOM 变化都会触发，标记确保 tab 只注入一次，即使 tab 栏未被销毁。
- **选择器失效静默处理**：`if (!slider ...)` 在找不到节点时直接返回，不抛错。

## Build & Deploy

功能包含在已有的 player enhancer build 步骤中，无需新的 CI 步骤：

```bash
make build-enhancer   # 构建 src/player-enhancer → JellyfinSuite.Plugin/Web/
make update           # 部署到 jellyfin-dev 容器验证
```
