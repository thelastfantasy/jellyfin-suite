# AI 协作规范（agents.md）

本文件约束 Claude Code 等 AI 助手在此项目中的行为。

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
