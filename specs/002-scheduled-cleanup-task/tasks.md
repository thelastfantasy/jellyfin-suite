# Tasks: 播放记录手动清理任务

**Input**: Design documents from `specs/002-scheduled-cleanup-task/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Spec 未要求必须编写测试，但建议添加数据库清理方法的基本单元测试以保证回归安全。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 无需额外初始化——项目结构已存在，仅需确认依赖就绪

- [x] T001 确认 `Jellyfin.Controller 10.10.7` 已包含 `MediaBrowser.Model.Tasks.IScheduledTask` 接口

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 在 `RecentsDatabase.cs` 中添加四个方法（三个清理 + 一个 VACUUM），供所有任务类调用

**⚠️ CRITICAL**: 所有用户任务 (US1/US2/US3/US4) 依赖此阶段完成

- [x] T002 在 `src/JellyfinRecents.Plugin/Data/RecentsDatabase.cs` 中添加 `DeleteExpiredRecordsAsync(DateTime cutoff, IProgress<double> progress, CancellationToken ct) → Task<int>` 方法：分批删除 `played_at < cutoff` 的所有记录，每批 ≤ 1000 条，支持进度报告和取消
- [x] T003 [P] 在 `src/JellyfinRecents.Plugin/Data/RecentsDatabase.cs` 中添加 `DeletePerUserExcessAsync(int maxRecords, IProgress<double> progress, CancellationToken ct) → Task<int>` 方法：查询所有 `DISTINCT user_id`，逐用户删除超出 `maxRecords` 条的最旧记录，支持进度报告和取消
- [x] T004 [P] 在 `src/JellyfinRecents.Plugin/Data/RecentsDatabase.cs` 中添加 `DeleteGlobalExcessAsync(int maxRecords, IProgress<double> progress, CancellationToken ct) → Task<int>` 方法：保留全表最新 `maxRecords` 条记录，删除其余，支持进度报告和取消
- [x] T005 [P] 在 `src/JellyfinRecents.Plugin/Data/RecentsDatabase.cs` 中添加 `VacuumDatabaseAsync(IProgress<double> progress) → Task<(long beforeSize, long afterSize)>` 方法：记录执行前 `.db` 文件大小 → 执行 `VACUUM` → 记录执行后文件大小 → 返回前后大小元组

**Checkpoint**: RecentsDatabase 维护能力就绪 — 可以开始实现各任务类

---

## Phase 3: User Story 1 - 清理过期播放记录 (Priority: P1) 🎯 MVP

**Goal**: 管理员可在 Dashboard Tasks 页面手动执行"清理过期播放记录"任务，删除 2 年前的所有播放记录

**Independent Test**: 准备含 1 年前和 3 年前记录的数据库，执行任务后验证 3 年前的已删除、1 年前的保留

### Implementation for User Story 1

- [x] T006 [US1] 创建 `src/JellyfinRecents.Plugin/Tasks/CleanExpiredRecordsTask.cs`，实现 `IScheduledTask`：`Key = "JellyfinRecents.CleanExpired"`、`Name = "清理过期播放记录"`、`Description = "删除 2 年前的所有播放记录"`、`Category = "Jellyfin Recents"`、`GetDefaultTriggers()` 返回空集合
- [x] T007 [US1] 在 `CleanExpiredRecordsTask.ExecuteAsync` 中调用 `RecentsDatabase.DeleteExpiredRecordsAsync(DateTime.UtcNow.AddYears(-2), progress, ct)`，并报告进度（0% → 50% → 100%）

**Checkpoint**: 任务 1 可在 Dashboard Tasks 页面显示并手动执行

---

## Phase 4: User Story 2 - 按用户保留最新 10000 条 (Priority: P2)

**Goal**: 管理员可手动执行"按用户整理记录"任务，对每个用户各自保留最新 10000 条

**Independent Test**: 准备用户 A（15000 条）和用户 B（500 条），执行后验证 A 剩 10000 条、B 全部保留

### Implementation for User Story 2

- [x] T008 [US2] 创建 `src/JellyfinRecents.Plugin/Tasks/CleanPerUserExcessTask.cs`，实现 `IScheduledTask`：`Key = "JellyfinRecents.CleanPerUserExcess"`、`Name = "按用户整理记录"`、`Description = "对每个用户各自保留最新 10000 条播放记录，超出部分删除"`、`Category = "Jellyfin Recents"`、`GetDefaultTriggers()` 返回空集合
- [x] T009 [US2] 在 `CleanPerUserExcessTask.ExecuteAsync` 中调用 `RecentsDatabase.DeletePerUserExcessAsync(10000, progress, ct)`，并报告进度（0% → 50% → 100%）

**Checkpoint**: 任务 2 可在 Dashboard Tasks 页面显示并手动执行

---

## Phase 5: User Story 3 - 全局保留最新 10000 条 (Priority: P3)

**Goal**: 管理员可手动执行"全局整理记录"任务，全表仅保留最新 10000 条

**Independent Test**: 准备 50000 条记录的数据库，执行后验证仅剩最新 10000 条

### Implementation for User Story 3

- [x] T010 [US3] 创建 `src/JellyfinRecents.Plugin/Tasks/CleanGlobalExcessTask.cs`，实现 `IScheduledTask`：`Key = "JellyfinRecents.CleanGlobalExcess"`、`Name = "全局整理记录"`、`Description = "⚠ 全局操作：仅保留最新 10000 条播放记录，其余全部删除。该操作影响所有用户。"`、`Category = "Jellyfin Recents"`、`GetDefaultTriggers()` 返回空集合
- [x] T011 [US3] 在 `CleanGlobalExcessTask.ExecuteAsync` 中调用 `RecentsDatabase.DeleteGlobalExcessAsync(10000, progress, ct)`，并报告进度（0% → 50% → 100%）

**Checkpoint**: 任务 3 可在 Dashboard Tasks 页面显示并手动执行

---

## Phase 6: User Story 4 - 数据库优化（VACUUM）(Priority: P4)

**Goal**: 管理员可手动执行"优化数据库"任务，执行 VACUUM 重建数据库文件并回收空间

**Independent Test**: 插入 50000 条后删除 40000 条，执行 VACUUM 前后对比文件大小，验证显著减小

### Implementation for User Story 4

- [x] T012 [US4] 创建 `src/JellyfinRecents.Plugin/Tasks/CleanVacuumDatabaseTask.cs`，实现 `IScheduledTask`：`Key = "JellyfinRecents.VacuumDatabase"`、`Name = "优化数据库"`、`Description = "执行 VACUUM 重建数据库文件，回收已删除记录占用的磁盘空间。执行期间数据库将被短暂锁定。"`、`Category = "Jellyfin Recents"`、`GetDefaultTriggers()` 返回空集合
- [x] T013 [US4] 在 `CleanVacuumDatabaseTask.ExecuteAsync` 中：(a) 调用 `RecentsDatabase.VacuumDatabaseAsync(progress)`；(b) 通过 `ILogger` 输出优化前/后文件大小及节省空间；(c) 将"优化前 X MB → 优化后 Y MB，节省 Z MB"写入任务结果

**Checkpoint**: 任务 4 可在 Dashboard Tasks 页面显示并手动执行

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 测试与验证

- [x] T014 [P] 在 `tests/JellyfinRecents.Tests/` 中添加 `DeleteExpiredRecordsAsync` 的单元测试（验证过期删除逻辑、边界条件、空表处理）
- [x] T015 [P] 在 `tests/JellyfinRecents.Tests/` 中添加 `DeletePerUserExcessAsync` 的单元测试（验证多用户、恰好边界、少量用户场景）
- [x] T016 [P] 在 `tests/JellyfinRecents.Tests/` 中添加 `DeleteGlobalExcessAsync` 的单元测试（验证全表截断逻辑）
- [x] T017 [P] 在 `tests/JellyfinRecents.Tests/` 中添加 `VacuumDatabaseAsync` 的单元测试（验证文件大小变化、空表处理）
- [x] T018 运行 `dotnet test tests/JellyfinRecents.Tests` 确认所有测试通过
- [x] T019 运行 `dotnet build src/JellyfinRecents.Plugin -c Debug` 确认编译无错误

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖 — 仅确认接口可用
- **Foundational (Phase 2)**: 依赖 Setup — **阻塞所有用户故事**
- **User Stories (Phase 3-6)**: 全部依赖 Foundational (Phase 2) 完成
  - US1、US2、US3、US4 之间无相互依赖，可并行实现
- **Polish (Phase 7)**: 依赖所有用户故事完成

### Within Each User Story

- 任务类创建 → 执行逻辑实现（每个故事内部分两步）
- 每个故事独立可测试

### Parallel Opportunities

- Phase 2 的 T002-T005 均在同一文件（`RecentsDatabase.cs`）中，建议合并为单次提交
- Phase 3-6 的四个任务类（T006-T013）之间完全独立，可并行实现
- Phase 7 的 T014-T017 完全独立，可并行编写

---

## Parallel Example: User Story Phases

```bash
# Phase 3-6 全部可并行：
Task: "创建 CleanExpiredRecordsTask.cs (US1)"
Task: "创建 CleanPerUserExcessTask.cs (US2)"
Task: "创建 CleanGlobalExcessTask.cs (US3)"
Task: "创建 CleanVacuumDatabaseTask.cs (US4)"

# Phase 7 测试全部可并行：
Task: "测试 DeleteExpiredRecordsAsync (T014)"
Task: "测试 DeletePerUserExcessAsync (T015)"
Task: "测试 DeleteGlobalExcessAsync (T016)"
Task: "测试 VacuumDatabaseAsync (T017)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002-T004) — 关键阻塞
3. Complete Phase 3: User Story 1 (T005-T006)
4. **STOP and VALIDATE**: 部署到测试 Jellyfin，在 Dashboard Tasks 页面手动触发验证
5. Deploy as MVP

### Incremental Delivery

1. Setup + Foundational → 数据库维护能力就绪
2. Add US1 → 部署验证 (MVP!)
3. Add US2 → 部署验证
4. Add US3 → 部署验证
5. Add US4 → 部署验证
6. Add Tests → 回归安全

### Parallel Team Strategy

如有多人：
1. 团队共同完成 Setup + Foundational
2. Foundational 完成后：
   - Developer A: US1 (T005-T006)
   - Developer B: US2 (T007-T008)
   - Developer C: US3 (T010-T011)
   - Developer D: US4 (T012-T013)
3. 各故事独立完成和部署

---

## Notes

- [P] tasks = 不同文件，无依赖
- [Story] label 将任务映射到用户故事以便追溯
- 四个任务类共享 `RecentsDatabase` 中的方法（任务 1-3 共享清理方法，任务 4 使用 VACUUM 方法）
- SQL 分批删除使用 `DELETE ... WHERE rowid IN (SELECT rowid ... LIMIT 1000)` 模式，仅任务 1-3
- 任务通过 Jellyfin 自动发现注册，无需修改 `Plugin.cs` 或 `PluginServiceRegistrator.cs`
- 任务描述中 US3 必须包含 `⚠` 警告前缀
- VACUUM 不可取消，执行时独占锁；任务 1-3 支持分批取消
- 编译后验证：Dashboard → Scheduled Tasks 页面应有 "Jellyfin Recents" 分类及四个任务
