using Jellyfin.Plugin.JellyfinRecents.Data;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Tasks;

public class CleanInvalidRecordsTask : IScheduledTask
{
    private readonly RecentsDatabase _db;
    private readonly IUserManager _userManager;
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<CleanInvalidRecordsTask> _logger;

    public CleanInvalidRecordsTask(
        RecentsDatabase db,
        IUserManager userManager,
        ILibraryManager libraryManager,
        ILogger<CleanInvalidRecordsTask> logger)
    {
        _db = db;
        _userManager = userManager;
        _libraryManager = libraryManager;
        _logger = logger;
    }

    public string Key => "JellyfinRecents.CleanInvalid";

    public string Name => "清理无效记录";

    public string Description => "删除用户已不存在或媒体已删除的无效播放记录，每日自动执行";

    public string Category => "Jellyfin Recents";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        return new[]
        {
            new TaskTriggerInfo
            {
                Type = "DailyTrigger",
                TimeOfDayTicks = 0 // UTC 00:00
            }
        };
    }

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var totalDeleted = 0;

        // ── 清理无效用户 ──────────────────────────────────────────────
        _logger.LogInformation("CleanInvalidRecords: checking for invalid users");
        var userIds = await _db.GetDistinctUserIdsAsync(cancellationToken);
        var invalidUserIds = new HashSet<string>();

        foreach (var uid in userIds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!Guid.TryParse(uid, out var userGuid) || userGuid == Guid.Empty)
            {
                invalidUserIds.Add(uid);
                continue;
            }
            var user = _userManager.GetUserById(userGuid);
            if (user is null)
                invalidUserIds.Add(uid);
        }

        if (invalidUserIds.Count > 0)
        {
            _logger.LogInformation("CleanInvalidRecords: found {Count} invalid users", invalidUserIds.Count);
            totalDeleted += await _db.DeleteRecordsByFieldAsync("user_id", invalidUserIds, null, cancellationToken);
        }

        // ── 清理无效媒体 ──────────────────────────────────────────────
        _logger.LogInformation("CleanInvalidRecords: checking for invalid items");
        var itemIds = await _db.GetDistinctItemIdsAsync(cancellationToken);
        var invalidItemIds = new HashSet<string>();

        // 分批检查以报告进度
        var checked_ = 0;
        foreach (var iid in itemIds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!Guid.TryParse(iid, out var itemGuid) || itemGuid == Guid.Empty)
            {
                invalidItemIds.Add(iid);
                continue;
            }

            var item = _libraryManager.GetItemById(itemGuid);
            if (item is null)
                invalidItemIds.Add(iid);

            checked_++;
            if (itemIds.Count > 0)
                progress.Report(Math.Min(50, (double)checked_ / itemIds.Count * 50));
        }

        if (invalidItemIds.Count > 0)
        {
            _logger.LogInformation("CleanInvalidRecords: found {Count} invalid items", invalidItemIds.Count);
            totalDeleted += await _db.DeleteRecordsByFieldAsync("item_id", invalidItemIds, null, cancellationToken);
        }

        progress.Report(100);
        _logger.LogInformation("CleanInvalidRecords: done, {Count} total records deleted", totalDeleted);
    }
}
