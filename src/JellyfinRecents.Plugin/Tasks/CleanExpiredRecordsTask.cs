using Jellyfin.Plugin.JellyfinRecents.Data;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Tasks;

public class CleanExpiredRecordsTask : IScheduledTask
{
    private readonly RecentsDatabase _db;
    private readonly ILogger<CleanExpiredRecordsTask> _logger;

    public CleanExpiredRecordsTask(RecentsDatabase db, ILogger<CleanExpiredRecordsTask> logger)
    {
        _db = db;
        _logger = logger;
    }

    public string Key => "JellyfinRecents.CleanExpired";

    public string Name => "清理 2 年前播放记录";

    public string Description => "删除 2 年前的所有播放记录";

    public string Category => "Jellyfin Recents";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => [];

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var cutoff = DateTime.UtcNow.AddYears(-2);
        _logger.LogInformation("CleanExpiredRecords: deleting records before {Cutoff:O}", cutoff);
        var deleted = await _db.DeleteExpiredRecordsAsync(cutoff, progress, cancellationToken);
        _logger.LogInformation("CleanExpiredRecords: done, {Count} records deleted", deleted);
    }
}
