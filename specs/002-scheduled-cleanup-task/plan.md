# Implementation Plan: 播放记录手动清理任务

**Branch**: `002-add-play-history-cleanup` | **Date**: 2026-05-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/002-scheduled-cleanup-task/spec.md`

## Summary

为插件添加四个手动 Jellyfin 定时维护任务：按时间清理 2 年前过期记录、按用户保留最新 10000 条、全局保留最新 10000 条、数据库优化（VACUUM）。通过 `IScheduledTask` 接口实现，由 Jellyfin 运行时自动发现，支持分批删除、进度报告和取消操作（VACUUM 任务除外）。

## Technical Context

**Language/Version**: C# 10 / .NET 8（插件壳）
**Primary Dependencies**:
- `Jellyfin.Controller 10.10.7`（`IScheduledTask`、`IProgress<double>`、`CancellationToken`）
- `Microsoft.Data.Sqlite 8.0.0`（批量 DELETE）
**Storage**: SQLite（`jellyfin-recents.db`，现有 play_history 表，无 schema 变更）
**Testing**: xUnit（数据库清理方法单元测试）
**Target Platform**: Jellyfin Server 10.8.0+（targetAbi 10.8.0.0）
**Project Type**: Jellyfin 服务端插件（C# DLL）
**Performance Goals**: 清理 50000 条过期记录 < 10 秒
**Constraints**:
- 四个任务均无默认触发器（纯手动）
- 任务通过 Jellyfin 自动发现注册（无需 DI 显式注册）
- 任务 1-3：分批删除每批 ≤ 1000 条，支持取消
- 任务 4（VACUUM）：单次 SQL 命令，不可取消，执行时数据库独占锁
- 兼容 10.8.x ~ 10.11.x

## Constitution Check

> 本项目尚未设置 Constitution（constitution.md 为空模板）。无约束门控，跳过检查。

## Project Structure

### Documentation (this feature)

```text
specs/002-scheduled-cleanup-task/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: Research & decisions
├── data-model.md        # Phase 1: Data model & contracts
├── quickstart.md        # Phase 1: Development quickstart
└── tasks.md             # Phase 2: Tasks (by /speckit-tasks)
```

### Source Code (changes)

```text
src/JellyfinRecents.Plugin/
├── Tasks/                              # NEW: Task classes
│   ├── CleanExpiredRecordsTask.cs      # Task 1: 删除 2 年前记录
│   ├── CleanPerUserExcessTask.cs       # Task 2: 按用户保留 10000 条
│   ├── CleanGlobalExcessTask.cs        # Task 3: 全局保留 10000 条
│   └── CleanVacuumDatabaseTask.cs      # Task 4: VACUUM 数据库优化
├── Data/
│   └── RecentsDatabase.cs              # MODIFY: 添加 4 个方法（3 清理 + 1 VACUUM）
tests/JellyfinRecents.Tests/
└── RecentsDatabaseTests.cs             # MODIFY: 添加清理方法测试
```

**Structure Decision**: 新建 `Tasks/` 目录存放任务类，每个任务一个文件，保持与现有 `Events/`、`Services/`、`Data/` 同级目录的组织方式一致。`RecentsDatabase.cs` 中新增清理方法，保持数据访问逻辑集中于同一类。

## Complexity Tracking

> 无 Constitution Check 违规，无需跟踪。
