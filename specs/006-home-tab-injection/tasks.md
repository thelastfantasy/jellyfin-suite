# Tasks: Home Tab Injection

**Input**: `specs/006-home-tab-injection/`
**Branch**: `feat/home-tab-injection`
**Prerequisites**: spec.md ✅ plan.md ✅

---

## Phase 1: 实现

- [ ] T001 在 `src/player-enhancer/src/i18n.ts` 的三个 locale（en/zh/ja）中新增 `nav.recentlyPlayed` key
  - en: `'Recently Played'`
  - zh: `'最近播放'`
  - ja: `'最近再生'`

- [ ] T002 新建 `src/player-enhancer/src/home-tab.ts`，实现 `injectHomeTab()` 函数（见 plan.md 代码片段）

- [ ] T003 在 `src/player-enhancer/src/injector.ts` 中：
  - 顶部 import `injectHomeTab` from `'./home-tab'`
  - `MutationObserver` 回调追加 `injectHomeTab()`
  - `initInjector()` 末尾追加 `injectHomeTab()`

## Phase 2: 构建 & 验证

- [ ] T004 `make build-enhancer` — 确认无 TypeScript 编译错误

- [ ] T005 `make update` — 部署到 jellyfin-dev 容器

- [ ] T006 在浏览器验证 Acceptance Scenarios（见 spec.md User Story 1）：
  - 主页顶部 tab 栏出现"Recently Played"
  - 点击后跳转插件页
  - 返回主页后 tab 重新出现（只出现一次）
  - 切换语言（中/英/日）后 tab 文字对应变化

## Phase 3: 提交

- [ ] T007 commit + PR → main，标题：`feat: inject Recently Played tab into Jellyfin home tab bar`

- [ ] T008 发布新版本（版本号待定，功能性新增 → minor bump 或 patch 视范围而定）
