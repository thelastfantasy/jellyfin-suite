using Jellyfin.Plugin.JellyfinRecents.Data;
using Jellyfin.Plugin.JellyfinRecents.i18n;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Tasks;

public class CleanVacuumDatabaseTask : IScheduledTask
{
    private readonly RecentsDatabase _db;
    private readonly ILogger<CleanVacuumDatabaseTask> _logger;

    public CleanVacuumDatabaseTask(RecentsDatabase db, ILogger<CleanVacuumDatabaseTask> logger)
    {
        _db = db;
        _logger = logger;
    }

    public string Key => "JellyfinRecents.VacuumDatabase";

    public string Name => TaskStrings.Get("CleanVacuum.Name");

    public string Description => TaskStrings.Get("CleanVacuum.Desc");

    public string Category => "Jellyfin Recents";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => [];

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        _logger.LogInformation("VacuumDatabase: starting VACUUM");

        var (beforeSize, afterSize) = await _db.VacuumDatabaseAsync(progress);

        _logger.LogInformation(
            "VacuumDatabase: 优化前 {Before} → 优化后 {After}，节省 {Saved}",
            FormatSize(beforeSize), FormatSize(afterSize), FormatSize(beforeSize - afterSize));
    }

    private static string FormatSize(long bytes)
    {
        if (bytes >= 1048576)
            return $"{bytes / 1048576.0:F1} MB";
        if (bytes >= 1024)
            return $"{bytes / 1024.0:F1} KB";
        return $"{bytes} Bytes";
    }
}
