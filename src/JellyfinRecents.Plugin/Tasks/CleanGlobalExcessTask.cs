using Jellyfin.Plugin.JellyfinRecents.Data;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Tasks;

public class CleanGlobalExcessTask : IScheduledTask
{
    private readonly RecentsDatabase _db;
    private readonly ILogger<CleanGlobalExcessTask> _logger;

    public CleanGlobalExcessTask(RecentsDatabase db, ILogger<CleanGlobalExcessTask> logger)
    {
        _db = db;
        _logger = logger;
    }

    public string Key => "JellyfinRecents.CleanGlobalExcess";

    public string Name => "全局保留最新 10000 条";

    public string Description => "⚠ 全局操作：仅保留最新 10000 条播放记录，其余全部删除。该操作影响所有用户。";

    public string Category => "Jellyfin Recents";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => [];

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        const int maxRecords = 10000;
        _logger.LogInformation("CleanGlobalExcess: keeping only {Max} records globally", maxRecords);
        var deleted = await _db.DeleteGlobalExcessAsync(maxRecords, progress, cancellationToken);
        _logger.LogInformation("CleanGlobalExcess: done, {Count} records deleted", deleted);
    }
}
