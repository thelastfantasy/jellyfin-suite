# Implementation Plan: Jellyfin 最近播放视图插件

**Branch**: `001-recents-view-plugin` | **Date**: 2026-05-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-recents-view-plugin/spec.md`

## Summary

为 Jellyfin Web 开发一个插件，提供自定义的"最近播放"浏览视图。用户可按天/周/月/季度/年对播放记录分组，选择多种排序方式，并通过重复条目开关控制显示粒度。

技术方案：最小化 C# 插件壳（注册插件页面 + 提供播放历史 API 端点）+ TypeScript/Preact 前端 SPA（实现全部 UI 逻辑），通过 Jellyfin 官方 SDK 调用服务端数据。

**规格变更（来自 research.md）**:
- "收藏时间"排序字段 → 改为"**收藏优先**"排序（Jellyfin API 不提供收藏时间戳）

## Technical Context

**Language/Version**:
- TypeScript 5.x（前端，主要）
- C# 10 / .NET 8（插件壳，最小化）

**Primary Dependencies**:
- `@jellyfin/sdk`（Jellyfin TypeScript SDK）
- Preact（轻量 UI 框架，~3KB；与 React 相同 JSX/hooks API，TypeScript 支持完整）
- Vite（TypeScript 构建，输出单文件 iife bundle；`@preact/preset-vite` 处理 JSX）
- Jellyfin `BasePlugin<T>`、`IHasWebPages`（C# 插件基类）
- ASP.NET Core Controller（C# 自定义 API 端点）

**CSS 策略**:
- **不引入** CSS-in-JS 库（PandaCSS/Tailwind 等）——IIFE bundle 需 CSS 注入插件，增加不必要的构建复杂度
- 直接使用 **Jellyfin CSS 变量**（`--theme-text-color`、`--theme-body-background-color` 等）确保自动适配深色/浅色主题
- 组件级样式使用 scoped `<style>` 块或 CSS Modules（Vite 原生支持）

**Storage**: 无自定义数据库。用户偏好持久化至浏览器 localStorage

**Testing**:
- TypeScript：Vitest（分组/排序/日期工具单元测试）
- C#：xUnit（PlayHistoryService 单元测试）

**Target Platform**: Jellyfin Web（Chrome/现代浏览器）；Jellyfin Server 10.8+

**Project Type**: Jellyfin 服务端插件（C# DLL） + 内嵌 TypeScript SPA

**Performance Goals**: 页面初始加载 < 3s；切换分组/排序 < 2s

**Constraints**:
- 前端必须通过 `window.ApiClient` 复用 Jellyfin Web 现有会话，不实现独立认证
- 插件通过 `/web/configurationpage?name=JellyfinRecents` 访问
- C# 端点需包装 Activity Log（仅返回当前用户数据），不暴露管理员权限

**Scale/Scope**: 单用户视图，API 调用量与用户播放历史规模成正比（典型用户 < 10,000 条）

## Constitution Check

> 本项目尚未设置 Constitution（constitution.md 为空模板）。无约束门控，跳过检查。

## Project Structure

### Documentation (this feature)

```text
specs/001-recents-view-plugin/
├── spec.md              # 功能规格
├── plan.md              # 本文件（实现计划）
├── research.md          # Phase 0 研究结论
├── data-model.md        # Phase 1 数据模型
├── contracts/
│   └── plugin-api.md    # API 契约
└── tasks.md             # Phase 2 任务列表（/speckit-tasks 生成）
```

### Source Code (repository root)

```text
src/
├── JellyfinRecents.Plugin/          # C# 插件项目
│   ├── Plugin.cs                    # 插件元数据 + IHasWebPages 注册
│   ├── PluginServiceRegistrator.cs  # DI 注册
│   ├── Controllers/
│   │   └── PlayHistoryController.cs # GET /JellyfinRecents/PlayHistory
│   ├── Services/
│   │   └── PlayHistoryService.cs    # 查询 Activity Log 的业务逻辑
│   ├── Models/
│   │   └── PlayHistoryEntry.cs      # API 响应体 DTO
│   ├── Configuration/
│   │   └── PluginConfiguration.cs   # 插件配置类（可为空）
│   ├── Web/
│   │   ├── config.html              # 嵌入资源：插件页面 HTML 入口
│   │   └── jellyfin-recents.js      # 嵌入资源：TypeScript 编译产物（构建后生成）
│   └── JellyfinRecents.Plugin.csproj
│
└── frontend/                        # TypeScript/Preact SPA
    ├── src/
    │   ├── main.tsx                 # 应用入口，挂载 Preact App
    │   ├── api/
    │   │   ├── jellyfinClient.ts    # 复用 window.ApiClient 初始化 SDK
    │   │   ├── itemsApi.ts          # 封装 getItems（不含重复模式）
    │   │   └── historyApi.ts        # 封装插件 PlayHistory 端点（含重复模式）
    │   ├── components/
    │   │   ├── App.tsx              # 顶层组件，管理 ViewSettings 状态
    │   │   ├── Toolbar.tsx          # 分组/排序/过滤控件栏
    │   │   ├── GroupSection.tsx     # 单个时间分组（含标题 + 条目列表）
    │   │   ├── PlayRecordCard.tsx   # 单条播放记录卡片（缩略图 + 标题 + 播放时间）
    │   │   └── Pagination.tsx       # 翻页控件
    │   ├── grouping/
    │   │   ├── groupBy.ts           # 分组核心逻辑（按天/周/月/季度/年）
    │   │   └── dateUtils.ts         # 日期工具：季度计算、标签生成、窗口计算
    │   ├── sorting/
    │   │   └── sortBy.ts            # 分组内排序逻辑
    │   ├── state/
    │   │   └── viewSettings.ts      # ViewSettings 读写（localStorage）
    │   └── types.ts                 # 共享类型定义（PlayRecord, ViewSettings 等）
    ├── package.json
    ├── tsconfig.json
    └── vite.config.ts               # 输出 iife 单文件 bundle

tests/
├── JellyfinRecents.Tests/           # C# xUnit 测试
│   ├── PlayHistoryServiceTests.cs
│   └── JellyfinRecents.Tests.csproj
└── frontend/                        # Vitest 单元测试
    ├── groupBy.test.ts
    ├── dateUtils.test.ts
    └── sortBy.test.ts

jellyfin-recents.sln                 # .NET 解决方案
```

```text
.github/
└── workflows/
    ├── build.yml          # PR/push 构建验证（dotnet build + npm run build）
    └── release.yml        # tag push → 构建 → 打包 zip → 发布 GitHub Release → 更新 manifest
```

**Structure Decision**: Web application 变体（前端 + C# 后端），但前端为主体（约 80% 工作量），C# 为最薄的服务端壳。

## Development Workflow（Windows，无 WSL）

### 前端开发（TypeScript/Preact）

无需 Jellyfin 实例即可开发 UI：

```
cd src/frontend
npm run dev
```

Vite 启动开发服务器，配置 proxy 将 `/Users`、`/Items`、`/JellyfinRecents` 等 API 路径代理到本地 Jellyfin 实例。支持热更新（HMR），修改即见效果。

### C# 插件开发

**本地 Jellyfin（推荐，无需 Docker/WSL）**:

1. 从 [jellyfin.org](https://jellyfin.org) 安装 Jellyfin Windows 版（作为 Windows 服务运行）
2. 插件目录：`C:\ProgramData\Jellyfin\Server\plugins\JellyfinRecents\`
3. 在 `.csproj` 中配置 post-build 事件，构建后自动复制 DLL 到插件目录：
   ```xml
   <Target Name="CopyToJellyfin" AfterTargets="Build">
     <Copy SourceFiles="$(OutputPath)JellyfinRecents.Plugin.dll"
           DestinationFolder="$(JELLYFIN_PLUGINS_PATH)\JellyfinRecents\" />
   </Target>
   ```
4. 环境变量 `JELLYFIN_PLUGINS_PATH` 设为插件目录（各开发者本地配置，不提交）
5. 重启 Jellyfin 服务：`net stop JellyfinServer && net start JellyfinServer`（或在 Windows 服务管理器中操作）

### 端到端验证顺序

1. **Vitest 单元测试**：覆盖分组/排序/日期工具，离线可跑，最快反馈
2. **Vite dev server + proxy**：验证前端 UI 与真实 Jellyfin API 的交互
3. **完整插件验证**：`dotnet build` → 自动复制 → 重启 Jellyfin → 浏览器访问插件页面

## Release & Publishing

### 发布目标

插件通过 Jellyfin 第三方插件仓库机制分发。用户在 Jellyfin 控制台添加以下 URL 后即可安装：

```
https://thelastfantasy.github.io/jellyfin-recents/manifest.json
```

### manifest.json 格式

托管于 `gh-pages` 分支，结构如下：

```json
[{
  "guid": "（固定 GUID，C# Plugin.cs 中硬编码，发布后永不更改）",
  "name": "Jellyfin Recents",
  "description": "A customizable recently-played view with flexible grouping and sorting.",
  "overview": "Browse your play history grouped by day, week, month, season, or year.",
  "owner": "thelastfantasy",
  "category": "General",
  "versions": [{
    "version": "1.0.0.0",
    "changelog": "Initial release.",
    "targetAbi": "10.8.0.0",
    "sourceUrl": "https://github.com/thelastfantasy/jellyfin-recents/releases/download/v1.0.0/jellyfin-recents-v1.0.0.zip",
    "checksum": "（zip 文件的 MD5）",
    "timestamp": "2026-05-09T00:00:00Z"
  }]
}]
```

### GitHub Actions 流程

**`build.yml`**（PR/push 触发）:
- `dotnet build` 验证 C# 编译
- `npm run build` 验证 TypeScript 编译
- `dotnet test` 运行 xUnit 测试
- `npx vitest run` 运行前端单元测试

**`release.yml`**（push tag `v*.*.*` 触发）:
1. `npm run build`（TypeScript bundle → `src/JellyfinRecents.Plugin/Web/jellyfin-recents.js`）
2. `dotnet publish`（编译 C# 插件，输出 DLL）
3. 打包为 `jellyfin-recents-v{version}.zip`（含 DLL + meta.json）
4. 计算 zip 的 MD5 checksum
5. 创建 GitHub Release，上传 zip 附件
6. 更新 `gh-pages` 分支的 `manifest.json`（追加新版本条目）

### 版本号规范

格式：`Major.Minor.Build.Revision`（Jellyfin 要求四段式）
- 示例：`1.0.0.0`、`1.1.0.0`
- Git tag 使用三段式：`v1.0.0`，CI 自动补全为四段式

## Complexity Tracking

> Constitution 未设置，无门控违规，此节跳过。
