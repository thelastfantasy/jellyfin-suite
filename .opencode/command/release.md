---
description: "创建新版本 Release：打 tag、推送、生成详细 Release Notes"
argument-hint: "[version]"
---

## User Input

```text
$ARGUMENTS
```

## Outline

用户提供版本号（如 `1.2.1`）或留空让 AI 自动递增 patch 版本。

1. **确定版本号**：
   - 如果 `$ARGUMENTS` 非空，用用户提供的版本号
   - 否则读取最新 tag（`git tag --sort=-version:refname`），取最高版本并递增 patch 位（如 `1.2.0` → `1.2.1`）

2. **构建验证**：
   ```bash
   cd src/frontend && npm ci && npm run build && cd ../..
   dotnet build src/JellyfinRecents.Plugin/JellyfinRecents.Plugin.csproj -c Release
   dotnet test tests/JellyfinRecents.Tests/JellyfinRecents.Tests.csproj -c Release --no-build
   ```
   任何一种失败则终止。

3. **提交未提交变更**（如有）：
   ```bash
   git add . && git commit -m "chore: prepare for release v{version}"
   ```

4. **打 Tag 并推送**：
   ```bash
   git tag v{version}
   git push origin v{version}
   ```

5. **等待 GitHub Actions workflow 完成**（约 2 分钟）。Workflow 构建并上传 `.zip` 到 release。

6. **下载 asset，用当前用户重建 Release**（替换 bot 创建的 release）：
   ```bash
   # 下载 bot 创建的 release 中的 zip
   gh release download v{version} --dir /tmp/release

   # 删除 bot 的 release
   gh release delete v{version} --yes

   # 用当前用户身份重新创建
   gh release create v{version} /tmp/release/*.zip \
     --title "v{version}" \
     --notes "...详细 Release Notes..."
   ```
   这样 release 作者显示为你的 GitHub 账号。

6. **整理 Release Notes**——从上次 release 到当前 tag 的 commits 中提取变更摘要，按以下分类：
   - New Features
   - Bug Fixes
   - Improvements
   - Breaking Changes

   格式参考：
   ```
   - **功能描述** — 详细说明
   ```

   与步骤 5 创建的 release 一起使用。

7. **报告完成**：输出 Release URL 和版本号。
