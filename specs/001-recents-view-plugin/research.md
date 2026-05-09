# Research: Jellyfin 最近播放视图插件

**Created**: 2026-05-09
**Branch**: `001-recents-view-plugin`

---

## 决策 1：C# 插件页面注册机制

**决策**: 采用 `IPlugin` + `IHasWebPages` + 自定义 API Controller 三层架构

**方案**:
- C# 插件实现 `BasePlugin<TConfiguration>` + `IHasWebPages`
- `GetPages()` 返回 `PluginPageInfo`，嵌入 HTML 入口文件作为 DLL 资源
- 页面通过 Jellyfin 内置路由提供：`/web/configurationpage?name=JellyfinRecents`
- TypeScript 编译产物（单一 JS bundle）也作为嵌入资源随 DLL 分发
- TypeScript 前端通过 `window.ApiClient`（Jellyfin Web 全局对象）获取当前用户 session 和 token，无需独立认证流程

**替代方案评估**:
| 方案 | 评估 |
|------|------|
| 纯 Jellyfin Web 客户端插件（JS） | 文档不完善，主要用于媒体播放器，不支持注册自定义页面路由 |
| Fork Jellyfin Web | 需维护 fork，用户需使用自定义 Web 客户端，维护成本高 |
| 独立 Web App | 完全脱离 Jellyfin UI，用户体验割裂 |

---

## 决策 2：重复播放记录数据源

**发现**: Jellyfin 的 `Items API` + `UserData.LastPlayedDate` 每个条目只记录**最后一次**播放时间。要获取同一条目的多次播放记录，需要查询 **Activity Log**。

**Jellyfin Activity Log**:
- REST 端点: `GET /System/ActivityLog/Entries`
- 默认为**管理员权限**端点，普通用户无法直接调用
- 包含每次播放事件（类型 `VideoPlayback` / `AudioPlayback`）的完整时间戳

**决策**: C# 插件额外实现一个**用户专属的播放历史 API 端点**
- 端点: `GET /JellyfinRecents/PlayHistory`（需有效用户 token）
- 服务端查询 Activity Log，过滤当前用户的播放事件后返回
- 普通用户通过该端点获取自己的完整播放记录，不暴露管理员权限

**影响**: C# 插件工作量稍增（需实现 Controller + Service），但不超出预期范围。

**不含重复记录模式（默认）**:
- 直接使用 `Items API`，`sortBy=DatePlayed`，`filters=IsPlayed` — 简单高效
- 每个条目只出现一次（最近播放时间）

---

## 决策 3：「收藏时间」排序不可行 → 改为「收藏优先」排序

**发现**: Jellyfin `UserItemData` 中只有 `IsFavorite: boolean`，**不记录收藏时间戳**。无法按"收藏时间"排序。

**决策**: 将排序选项"收藏时间"修改为"**收藏优先**"（已收藏的条目排在前面，未收藏的排在后面）

**规格影响**: 需回写 spec.md，将 FR-007 中"收藏时间"更新为"收藏优先（收藏状态）"

---

## 决策 4：TypeScript 构建工具

**决策**: 使用 **Vite** 作为构建工具，输出单一 bundle

**理由**:
- 开发体验好（HMR），便于调试
- 可配置为 library 模式输出单文件（`iife` 格式），适合嵌入 Jellyfin 插件页面
- TypeScript 原生支持

**替代方案**: esbuild（更快但配置更原始，Vite 底层已使用 esbuild）

---

## 决策 5：前端 UI 框架

**决策**: 使用 **Preact**（轻量 React 兼容层，~3KB）

**理由**:
- 相较于纯 Vanilla TypeScript，组件化开发效率高
- Preact 体积极小，适合嵌入插件页面
- Jellyfin Web 本身使用类 React 写法，Preact 风格一致
- 无需引入 React 全量包

---

## 决策 6：分组/分页逻辑实现

**决策**: 全部在前端实现（TypeScript）

**数据流**:
1. 调用 Jellyfin Items API 获取时间窗口内所有已播放条目（含 `LastPlayedDate`）
2. 或调用插件 PlayHistory API 获取含重复记录的原始事件列表
3. 前端按选定分组维度（天/周/月/季度/年）对 `playedDate` 分组
4. 分组内按选定排序字段排序
5. 按页码裁剪展示分组

**季度命名**（中文，固定规则）:
```
1-3月 → 冬季
4-6月 → 春季
7-9月 → 夏季
10-12月 → 秋季
```

---

## 决策 7：用户偏好持久化

**决策**: 使用 **localStorage**

- Key: `jellyfin-recents-settings`
- 存储: 分组方式、排序方式、内容类型过滤、重复条目开关
- 作用域: 当前浏览器，不跨设备同步（与 spec Assumptions 一致）

---

## 决策 8：开发环境（Windows，无 WSL）

**决策**: 本地安装 Jellyfin Windows 服务 + `.csproj` post-build 自动复制 DLL

**理由**:
- 无 WSL，排除 Docker WSL2 后端方案
- Docker + Hyper-V 可用但较重，启停慢
- Jellyfin Windows 原生安装轻量，重启服务约 5 秒
- 前端用 Vite dev server + proxy，无需触碰 C# 层即可独立开发

**不采用方案**: Docker（需 Hyper-V，启停慢）、在 Jellyfin 源码中调试（复杂度过高）

---

## 决策 9：插件发布机制

**决策**: GitHub Releases（zip 分发）+ GitHub Pages（manifest.json 托管）+ GitHub Actions（CI/CD）

**理由**: 与 MetaTube 等主流第三方 Jellyfin 插件采用相同机制，Jellyfin 原生支持，用户体验一致。

**关键约束**: 插件 GUID 在 `Plugin.cs` 中一次性生成后**永不更改**，否则 Jellyfin 无法识别为同一插件的更新。

---

## 已解决的所有 NEEDS CLARIFICATION

| 原始问题 | 解决方案 |
|---------|---------|
| 重复播放记录数据源 | C# 插件自定义 API 端点包装 Activity Log |
| 「收藏时间」排序 | 改为「收藏优先」排序（boolean 排序） |
| 插件页面如何进入 | `/web/configurationpage?name=JellyfinRecents`，Jellyfin Dashboard 可见 |
| 前端认证 | 复用 `window.ApiClient`，无需独立登录流程 |
| 开发环境（无 WSL） | 本地 Jellyfin Windows 服务 + post-build 自动复制 DLL |
| 插件发布机制 | GitHub Releases + GitHub Pages manifest + GitHub Actions |
