# Research: 播放记录手动清理任务

**Created**: 2026-05-11
**Branch**: `002-add-play-history-cleanup`

---

## 决策 1：IScheduledTask 接口与注册机制

**决策**: 使用 `MediaBrowser.Model.Tasks.IScheduledTask` 接口，依赖 Jellyfin 运行时自动扫描发现。

**关键发现**（来自 Jellyfin 10.10.7 源码及 Trakt 插件实践）:
- 接口位于 `MediaBrowser.Model.Tasks` 命名空间，10.8 ~ 10.11.x 完全稳定
- 无需显式 DI 注册：`ApplicationHost.RunStartupTasksAsync()` 自动扫描所有已加载程序集中的 `IScheduledTask` 实现
- 构造函数参数通过 DI 容器自动解析，可直接注入 `ILogger<T>`、`RecentsDatabase` 等
- `GetDefaultTriggers()` 返回空集合表示不设默认触发器（纯手动任务）
- `IProgress<double> progress` 值域 0~100，超限自动裁剪；`CancellationToken` 用于响应 Dashboard UI 的终止按钮

**实现要求**:
```csharp
public class CleanExpiredRecordsTask : IScheduledTask
{
    public string Key => "JellyfinRecents.CleanExpired";
    public string Name => "清理过期播放记录";
    public string Description => "删除 2 年前的所有播放记录";
    public string Category => "Jellyfin Recents";
    // 无默认触发器 → 返回空
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => [];
    // 执行逻辑...
}
```

**替代方案评估**:
| 方案 | 评估 |
|------|------|
| 手动 DI 注册 | 不必要，Jellyfin 已自动发现 |
| `IHostedService` 自行实现调度 | 重复造轮子，缺少 Dashboard UI 集成 |
| 单独的后台线程 | 无进度报告、无取消支持、不显示在 Tasks 页面 |

---

## 决策 2：分批删除策略

**决策**: 循环执行 `DELETE ... LIMIT 1000` 直到 `rowCount = 0`。

**方案**:
```sql
-- 任务 1 示例：删除 2 年前记录
DELETE FROM play_history 
WHERE rowid IN (
    SELECT rowid FROM play_history 
    WHERE played_at < @cutoff 
    LIMIT 1000
);
```

- SQLite 不支持 `DELETE ... LIMIT` 直接删除大量行（`SQLITE_LIMIT_COMPOUND_SELECT`），需使用子查询
- 每批 1000 条在性能和事务大小之间取得平衡
- 每批提交后可响应 `CancellationToken` 以实现中途取消
- WAL 模式下删除不阻塞并发写入

**替代方案评估**:
| 方案 | 评估 |
|------|------|
| 单条 DELETE 无 limit | 数十万条时长时间锁表，无法报告进度或取消 |
| 每批 10000 条 | 事务过大，取消响应不及时 |
| 在应用层逐条删除 | 性能极差，不可接受 |

---

## 决策 3：按用户查询与清理

**决策**: 先查询所有有记录的用户 ID 列表，再逐用户执行清理。

**方案**:
```sql
-- 获取所有有记录的用户
SELECT DISTINCT user_id FROM play_history;

-- 对每个用户，保留最新 10000 条
DELETE FROM play_history 
WHERE rowid IN (
    SELECT rowid FROM play_history 
    WHERE user_id = @userId 
    ORDER BY played_at DESC 
    LIMIT -1 OFFSET 10000  -- SQLite: LIMIT -1 = no limit, OFFSET skips first 10000
);
-- 或使用 COUNT + OFFSET 判断是否需要删除
```

**注意**: SQLite 的 `LIMIT -1 OFFSET N` 是支持的，`-1` 表示"返回所有"。这个模式可在单条 SQL 中完成 "保留最近 N 条，删除其余"。

**替代方案评估**:
| 方案 | 评估 |
|------|------|
| 应用层逐用户处理 | 用户数少时可接受（家庭场景 < 10 用户） |
| 全局 SQL 的窗口函数 | SQLite 3.25+ 支持 `ROW_NUMBER()`，但子查询 limit+offset 更透明 |
| 忽略用户维度全表处理 | 无法满足任务 2 的按用户保留需求 |

---

## 决策 4：进度报告策略

**决策**: 两阶段进度——获取待删除行数后报告 50%，删除完成后报告 100%。

```csharp
progress.Report(0);
var pending = await GetPendingCount(cancellationToken);
progress.Report(10);  // 查询完成

while (deletedThisBatch > 0)
{
    deletedThisBatch = await DeleteBatch(cancellationToken);
    totalDeleted += deletedThisBatch;
    // 10% → 90% 之间按比例推进
    progress.Report(10 + (80 * totalDeleted / pending));
    cancellationToken.ThrowIfCancellationRequested();
}

progress.Report(100);
return Task.CompletedTask;
// 结果通过 ScheduledTaskWorker 的 TaskResult 机制自动记录
```

---

## 决策 5：任务之间的代码复用

**决策**: 三个任务类共享 `RecentsDatabase` 中的清理方法。

**方案**: 在 `RecentsDatabase` 中添加以下方法：
```csharp
public async Task<int> DeleteExpiredRecordsAsync(DateTime cutoff, CancellationToken ct);
public async Task<int> DeletePerUserExcessAsync(int maxRecords, CancellationToken ct);
public async Task<int> DeleteGlobalExcessAsync(int maxRecords, CancellationToken ct);
```

- 任务类只负责 IScheduledTask 元数据和调用数据库方法
- 数据库方法内部实现分批删除和进度报告
- 保持单一职责：任务类 = 调度入口，数据库类 = SQL 执行

---

## 已解决的所有 NEEDS CLARIFICATION

无。spec 中无 `[NEEDS CLARIFICATION]` 标记，所有技术决策已在研究中覆盖。
