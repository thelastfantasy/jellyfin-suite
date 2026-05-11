# Quickstart: 播放记录手动清理任务

**Created**: 2026-05-11
**Branch**: `002-add-play-history-cleanup`

---

## 运行环境

- Jellyfin Server 10.8+（Windows 或 Docker）
- .NET 8 SDK
- 本地 Jellyfin 安装用于集成测试（参考 `specs/001-recents-view-plugin/quickstart.md`）

## 开发步骤

### 1. 构建插件

```powershell
dotnet build src/JellyfinRecents.Plugin -c Debug
```

### 2. 部署到本地 Jellyfin

```powershell
# 将 DLL 复制到 Jellyfin 插件目录
Copy-Item "src/JellyfinRecents.Plugin/bin/Debug/net8.0/JellyfinRecents.Plugin.dll" `
          "$env:JELLYFIN_PLUGINS_PATH\JellyfinRecents\" -Force

# 重启 Jellyfin 服务
Restart-Service JellyfinServer -ErrorAction SilentlyContinue
```

### 3. 验证任务注册

1. 打开 Jellyfin Dashboard → Scheduled Tasks
2. 在"Jellyfin Recents"分类下确认三个任务均已注册
3. 确认任务无默认触发器（Next Run 显示 "Never" 或 "--"）

### 4. 手动测试

1. 点击"清理过期播放记录"的 Run 按钮
2. 观察进度指示和完成状态
3. 检查 SQLite 数据库中 play_history 表记录数变化

## 测试

```powershell
# 运行 C# 单元测试
dotnet test tests/JellyfinRecents.Tests
```

## 关键约束

- 三个任务实现 `IScheduledTask` 接口（`MediaBrowser.Model.Tasks`）
- `GetDefaultTriggers()` 必须返回空集合
- 每批删除 ≤ 1000 条，批次间检查 `CancellationToken`
- 任务描述中任务 3 必须包含警告前缀
