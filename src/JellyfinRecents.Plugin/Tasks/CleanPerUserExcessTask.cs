using Jellyfin.Plugin.JellyfinRecents.Data;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Tasks;

public class CleanPerUserExcessTask : IScheduledTask
{
    private readonly RecentsDatabase _db;
    private readonly ILogger<CleanPerUserExcessTask> _logger;

    public CleanPerUserExcessTask(RecentsDatabase db, ILogger<CleanPerUserExcessTask> logger)
    {
        _db = db;
        _logger = logger;
    }

    public string Key => "JellyfinRecents.CleanPerUserExcess";

    public string Name => "按用户保留最新 10000 条";

    public string Description => "对每个用户各自保留最新 10000 条播放记录，超出部分删除";

    public string Category => "Jellyfin Recents";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => [];

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        const int maxRecords = 10000;
        _logger.LogInformation("CleanPerUserExcess: deleting records beyond {Max} per user", maxRecords);
        var deleted = await _db.DeletePerUserExcessAsync(maxRecords, progress, cancellationToken);
        _logger.LogInformation("CleanPerUserExcess: done, {Count} records deleted", deleted);
    }
}
