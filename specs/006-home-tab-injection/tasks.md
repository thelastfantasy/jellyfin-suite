# Tasks: Home Tab Injection

**Input**: `specs/006-home-tab-injection/`
**Branch**: `feat/home-tab-injection`
**Prerequisites**: spec.md ✅ plan.md ✅ research.md ✅

---

## Phase 1：Frontend 组件导出审查与修复

- [ ] T001 逐一检查 `src/frontend/src/components/` 下各组件：确认 `RecentlyPlayedView`、`PlayRecordCard`、分页组件、筛选组件等均有具名 export
- [ ] T002 确认 `src/frontend/src/api/` 全部函数已 export
- [ ] T003 确认 `src/frontend/src/i18n/` 全部已 export
- [ ] T004 检查各组件/模块是否有模块级副作用（自执行代码、全局状态初始化等），若有则隔离——确保 import 单个组件不触发意外行为
- [ ] T005 `make build`（仅 frontend）验证改动后配置页 bundle 构建无误，功能不变

## Phase 2：新建 `src/home-injector/` 包

- [ ] T006 创建目录结构（`src/`、`package.json`、`tsconfig.json`、`vite.config.ts`）
- [ ] T007 实现 `src/index.ts`：fetch HomeInjectorConfig，disabled 时 early return，否则调 `initHomeInjector()`
- [ ] T008 实现 `src/home-tab.ts`：`tryInject()` + MutationObserver，注入 tab 按钮和 panel，监听 `tabchange` 事件切换 `is-active`
- [ ] T009 实现 `src/mount.tsx`：`renderHomeTab(container)` 用 preact `render()` 挂载 `RecentlyPlayedView`
- [ ] T010 验证 panel 注入位置正确（DevTools 确认父容器选择器），必要时补充备选选择器
- [ ] T011 `npm run build` 确认 home-injector.js 构建到 `src/JellyfinSuite.Plugin/Web/` 无报错

## Phase 3：C# 后端

- [ ] T012 `PluginConfiguration.cs` 新增 `HomeTabEnabled`（默认 true）
- [ ] T013 新建 `HomeInjectorController.cs`，实现 GET/POST `HomeInjectorConfig`，含 `HomeInjectorConfigDto`（camelCase `[JsonPropertyName]`）
- [ ] T014 新建 `HomeInjectorEntryPoint.cs`，注入 `<script src="/JellyfinSuite/home-injector.js?v=...">` 到 index.html（与 PlayerEnhancerEntryPoint 结构相同）
- [ ] T015 `dotnet build` 确认无编译错误

## Phase 4：Frontend 配置页新增开关

- [ ] T016 `src/frontend/src/api/` 新增 `homeInjectorApi.ts`（GET/POST HomeInjectorConfig）
- [ ] T017 新增 i18n key：`homeTab.enabled`（en/zh/ja）
- [ ] T018 在配置页适当位置新增 Home Tab 开关 UI（建议独立 section，不影响现有播放器增强 UI）
- [ ] T019 开关保存时 dispatch `jfs:homeTabEnabledChanged` 自定义事件
- [ ] T020 home-injector 监听 `jfs:homeTabEnabledChanged`，动态移除或注入 tab

## Phase 5：构建集成

- [ ] T021 Makefile/mise.toml 新增 `build-home-injector` 步骤，纳入 `build` 和 `update` 流程
- [ ] T022 `make update` 端到端验证：两个 bundle 均正确部署到容器

## Phase 6：验证

- [ ] T023 验证 Acceptance Scenarios Story 1（tab 出现、点击切换、返回后重新出现）
- [ ] T024 验证 Story 2（功能完整性：分组、排序、筛选、翻页、卡片跳转）
- [ ] T025 验证 Story 3（配置页开关，disable 后 tab 消失）
- [ ] T026 验证 Story 4（配置页回归：功能和样式与重构前一致）
- [ ] T027 验证多语言（en/zh/ja tab 标签和视图内文字）

## Phase 7：提交

- [ ] T028 commit + PR，标题：`feat(006): home tab injection with shared frontend components`
- [ ] T029 发布新版本（minor bump：1.6.0）
