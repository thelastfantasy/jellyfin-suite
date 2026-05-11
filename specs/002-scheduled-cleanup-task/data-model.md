# Data Model: 播放记录手动清理任务

**Created**: 2026-05-11
**Branch**: `002-add-play-history-cleanup`

---

## 新实体

### CleanExpiredRecordsTask（清理过期播放记录 — 任务 1）

实现 `IScheduledTask`，纯手动触发。

| 属性 | 值 | 说明 |
|------|-----|------|
| `Key` | `"JellyfinRecents.CleanExpired"` | 唯一键（用于持久化历史） |
| `Name` | `"清理过期播放记录"` | Dashboard 显示名称 |
| `Description` | `"删除 2 年前的所有播放记录"` | Dashboard 描述 |
| `Category` | `"Jellyfin Recents"` | Dashboard 分类 |
| 触发器 | 无默认触发器 | 纯手动 |
| 保留期限 | 2 年（固定） | 当前时间 - 2 年 |

---

### CleanPerUserExcessTask（按用户整理记录 — 任务 2）

实现 `IScheduledTask`，纯手动触发。

| 属性 | 值 | 说明 |
|------|-----|------|
| `Key` | `"JellyfinRecents.CleanPerUserExcess"` | 唯一键 |
| `Name` | `"按用户整理记录"` | Dashboard 显示名称 |
| `Description` | `"对每个用户各自保留最新 10000 条播放记录，超出部分删除"` | Dashboard 描述 |
| `Category` | `"Jellyfin Recents"` | Dashboard 分类 |
| 触发器 | 无默认触发器 | 纯手动 |
| 上限 | 10000 条/用户（固定） | 对每个用户分别应用 |

---

### CleanGlobalExcessTask（全局整理记录 — 任务 3）

实现 `IScheduledTask`，纯手动触发。

| 属性 | 值 | 说明 |
|------|-----|------|
| `Key` | `"JellyfinRecents.CleanGlobalExcess"` | 唯一键 |
| `Name` | `"全局整理记录"` | Dashboard 显示名称 |
| `Description` | `"⚠ 全局操作：仅保留最新 10000 条播放记录，其余全部删除。该操作影响所有用户。"` | 含警告前缀 |
| `Category` | `"Jellyfin Recents"` | Dashboard 分类 |
| 触发器 | 无默认触发器 | 纯手动 |
| 上限 | 10000 条（固定） | 全表 |

---

### RecentsDatabase 新增方法

在现有 `RecentsDatabase` 类中添加三个清理方法：

| 方法 | 签名 | 用途 |
|------|------|------|
| `DeleteExpiredRecordsAsync` | `(DateTime cutoff, IProgress<double> progress, CancellationToken ct) → Task<int>` | 任务 1 |
| `DeletePerUserExcessAsync` | `(int maxRecords, IProgress<double> progress, CancellationToken ct) → Task<int>` | 任务 2 |
| `DeleteGlobalExcessAsync` | `(int maxRecords, IProgress<double> progress, CancellationToken ct) → Task<int>` | 任务 3 |

返回值均为 `int`：实际删除的总行数。

---

## 现有实体（无变更）

### play_history 表

清理操作的对象表，结构不变：

| 列 | 类型 | 说明 |
|-----|------|------|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | 自增 ID |
| `user_id` | `TEXT NOT NULL` | Jellyfin 用户 GUID |
| `item_id` | `TEXT NOT NULL` | 媒体条目 GUID |
| `played_at` | `TEXT NOT NULL` | ISO 8601 播放时间 |
| `media_type` | `TEXT NOT NULL` | 媒体类型 |

索引 `(user_id, played_at DESC)` 保持不变，对清理查询有效。

---

## 项目文件结构（本 Feature 新增/修改）

```text
src/JellyfinRecents.Plugin/
├── Tasks/
│   ├── CleanExpiredRecordsTask.cs      # 任务 1
│   ├── CleanPerUserExcessTask.cs       # 任务 2
│   └── CleanGlobalExcessTask.cs        # 任务 3
├── Data/
│   └── RecentsDatabase.cs              # 修改：添加 3 个清理方法
```
