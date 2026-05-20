# AI 协作规范（agents.md）

本文件约束 Claude Code 等 AI 助手在此项目中的行为。

## 当前功能上下文

For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/006-home-tab-injection/plan.md

## 核心原则

- **先测试，再部署，部署须确认。**
- **修改代码前，先同步 spec.md 和 tasks.md。**
- 所有与用户的交流使用中文。

## 部署工作流程

```
1. make test        — 运行全套测试（Rust + TypeScript + C#）
2. 报告测试结果     — 等待用户明确确认
3. make update      — 构建并部署到 jellyfin-dev（破坏性操作，须确认）
```

**禁止行为**：
- 未运行测试直接 `make build` / `make update`
- 未经用户确认执行任何部署操作
- 跳过 `make test` 直接报告"可以部署了"
- `make update` 会重启容器，是破坏性操作

## 代码变更工作流程

```
1. 更新 spec.md（功能需求）
2. 更新 tasks.md（任务列表，标记完成项）
3. 写/改代码
4. 运行 make test
5. 等用户确认后 make update
```

## 测试命令

**测试应通过 Makefile 运行**（在用户的终端里）：

| 命令                  | 说明                          |
|----------------------|-------------------------------|
| `make test`          | 运行全套测试（**推荐**）       |
| `make test-rust`     | Rust 单元测试（poster-gen）   |
| `make test-frontend` | TypeScript/Vitest 测试        |
| `make test-csharp`   | C# xUnit 测试                 |
| `make workflow-test` | 本地运行 build workflow（需要 Docker，用 `act`） |
| `make workflow-test-release` | 本地运行 release workflow（构建/打包步骤可测；GitHub Release 和 Pages deploy 步骤因需真实 token 会失败，属正常） |

若系统没有 `make`，可用 `mise run test` / `mise make test` 代替（mise 会通过 conda 安装 make）。

Claude 需要运行测试时，**优先调用 `make test`**（或具体套件的 `make test-rust` 等），而不是直接调用 `cargo test`/`vitest`/`dotnet test`。只有在 make 明确不可用时才退而使用各工具链命令。

`vitest.config.ts` 是专用测试配置（root = 项目根，server.fs.allow 包含 tests/），`vite.config.ts` 是构建配置，两者分开。

## 开发环境

- Jellyfin 容器：`jellyfin-dev`，访问地址 `http://localhost:8600`
- Docker Desktop 必须以管理员身份运行
- 容器停止时用 `docker start jellyfin-dev` 启动
- 如 config 卷损坏：`docker rm jellyfin-dev && docker volume rm jellyfin-config`

## Speckit 分支规范（强制覆盖）

**speckit 要求的 `00x-xxx` 格式分支命名必须无视。** speckit 的 git-feature hook（`/speckit-git-feature`）绝对不执行，规格文档（spec/plan/tasks）只在当前工作分支上提交，不得为 spec 工作单独创建新分支。

## C# JSON 序列化规范

**Jellyfin 插件的 ASP.NET Core 控制器默认使用 PascalCase 序列化 DTO 属性**（如 `SeekSeconds`），而非 camelCase（`seekSeconds`）。凡是新增 DTO 并在前端 JS/TS 读取其字段时，**必须**用以下任一方式保持一致：

1. **推荐**：给 DTO 属性加 `[JsonPropertyName("camelCaseName")]` 特性强制输出 camelCase
2. 或在前端同时处理两种大小写（兜底方案，不推荐）

**不要**直接在前端写 `data.seekSeconds` 就假定返回的是 camelCase，必须先确认实际 key 名。

## Shell 规范

- **所有 CLI 操作（npm、cargo、dotnet、make 等）一律用 bash**，不得使用 PowerShell
- 文件操作（Read/Write/Edit）使用 Windows 路径格式：`D:\Dev\...`
- bash 内路径使用 Unix 格式：`/d/Dev/...`

## 项目结构

```
src/
  JellyfinRecents.Plugin/   — C# Jellyfin 插件
  frontend/                 — TypeScript/Preact 前端
  poster-gen/               — Rust 海报生成器 CLI
tests/
  frontend/                 — Vitest 前端测试
  JellyfinRecents.Tests/    — C# xUnit 测试
specs/
  003-poster-sheet-generator/ — 当前功能规格文档
```
