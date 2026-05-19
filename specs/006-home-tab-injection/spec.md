# Feature Specification: Home Tab Injection

**Feature Branch**: `feat/home-tab-injection`
**Created**: 2026-05-19
**Status**: Draft

## Background

Jellyfin 主页顶部有一个 tab 栏（`div[is="emby-tabs"].tabs-viewmenubar`），默认含"首页"和"我的最爱"两个 tab。插件的"最近播放"视图目前只能通过左侧侧栏访问——侧栏在移动端需要手动打开，在桌面端也不如顶部 tab 醒目。

播放器增强功能已经通过向 `index.html` 注入 `<script>` 实现了运行时 DOM 操作，相同机制可以在 Jellyfin 页面渲染后注入一个 tab 按钮。

## Observed DOM Structure (Jellyfin 10.11.x)

```html
<div is="emby-tabs" data-index="0"
     class="tabs-viewmenubar emby-tabs focusable scrollX"
     data-scroll-mode-x="custom">
  <div class="emby-tabs-slider" style="white-space:nowrap;">
    <button type="button" is="emby-button"
            class="emby-tab-button emby-button emby-tab-button-active"
            data-index="0">
      <div class="emby-button-foreground">首页</div>
    </button>
    <button type="button" is="emby-button"
            class="emby-tab-button emby-button"
            data-index="1">
      <div class="emby-button-foreground">我的最爱</div>
    </button>
  </div>
</div>
```

注入目标：向 `.tabs-viewmenubar .emby-tabs-slider` 追加一个结构相同的 `button`。

## Clarifications

- Q: tab 只在主页存在，注入后跳转到插件页，回来时 tab 还在吗？ → A: 是。tab 栏随主页渲染，MutationObserver 会在每次主页重新出现时重新注入，幂等检查（`data-jfs-tab`）防止重复。
- Q: tab 在插件配置页上是否需要高亮 active 状态？ → A: 不需要。tab 栏仅在主页存在，用户进入插件页后 tab 栏消失，无需跨页管理 active 状态。
- Q: 是否需要在插件管理面板提供开关？ → A: 不需要，v1 默认注入。
- Q: 标签文字如何多语言化？ → A: 复用 player enhancer 已有的 `i18n.ts`，新增 `nav.recentlyPlayed` key（EN/ZH/JA）。
- Q: 如果 Jellyfin 更新后选择器失效，如何处理？ → A: 找不到目标节点时静默跳过，不报错，不影响播放器增强其他功能。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 主页顶部 tab 快速导航 (Priority: P1)

用户在 Jellyfin 主页希望通过顶部 tab 一键跳转最近播放视图，与"首页"、"我的最爱"并列，不需要展开侧栏。

**Independent Test**: 打开 Jellyfin 主页，顶部 tab 栏出现"Recently Played"（或对应语言文字）tab，点击后跳转到插件页面。

**Acceptance Scenarios**:

1. **Given** 用户在 Jellyfin 主页，**When** 页面渲染完成，**Then** 顶部 tab 栏末尾出现"Recently Played / 最近播放 / 最近再生"tab
2. **Given** 插件 tab 已注入，**When** 用户点击该 tab，**Then** 页面跳转到 `#!/configurationpage?name=JellyfinSuite`
3. **Given** 用户从插件页返回主页，**When** 主页重新渲染，**Then** 插件 tab 重新出现（且只出现一次）
4. **Given** Jellyfin 界面语言为中文，**When** tab 注入时，**Then** tab 文字显示为"最近播放"
5. **Given** Jellyfin 界面语言为日语，**When** tab 注入时，**Then** tab 文字显示为"最近再生"
6. **Given** `.tabs-viewmenubar` 选择器在未来版本失效，**When** 注入尝试找不到目标节点，**Then** 无报错，播放器增强其他功能不受影响
