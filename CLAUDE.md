<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/003-poster-sheet-generator/plan.md
<!-- SPECKIT END -->

## 部署工作流程（必须遵守）

**先测试，再部署，部署前必须征得用户同意。**

```
1. make test          ← 运行全套测试（Rust + TypeScript + C#）
2. [告知用户测试结果] ← 等待用户确认
3. make update        ← 部署（仅在用户明确确认后执行）
```

- 运行测试时**必须**用 `make test`（或 `mise run test`），`make` 是唯一正确的测试入口，不得直接调用 cargo/vitest/dotnet 替代
- 绝不在用户未运行测试并确认的情况下执行 `make build` 或 `make update`
- 绝不在用户未确认的情况下直接部署到 jellyfin-dev 容器
- `make update` 会重启容器，是破坏性操作
- 各命令详情见 agents.md 中的测试命令章节

## Shell 规范

- **所有 CLI 操作（npm、cargo、dotnet、make 等）一律用 bash**，不得使用 PowerShell
- 文件操作（Read/Write/Edit）使用 Windows 路径格式：`D:\Dev\...`
- bash 内路径使用 Unix 格式：`/d/Dev/...`
