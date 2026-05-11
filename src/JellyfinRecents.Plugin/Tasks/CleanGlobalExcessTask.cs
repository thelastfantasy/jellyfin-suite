using Jellyfin.Plugin.JellyfinRecents.Data;
using Jellyfin.Plugin.JellyfinRecents.i18n;
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

    public string Name => TaskStrings.Get("CleanGlobalExcess.Name");

    public string Description => TaskStrings.Get("CleanGlobalExcess.Desc");

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
