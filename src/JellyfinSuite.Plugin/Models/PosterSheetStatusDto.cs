namespace Jellyfin.Plugin.JellyfinSuite.Models;

public class PosterSheetStatusDto
{
    public string JobId { get; set; } = string.Empty;
    public string ItemId { get; set; } = string.Empty;
    public string ItemTitle { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public int Progress { get; set; }
    public int Total { get; set; }
    public string? Error { get; set; }
    public MediaInfoDto? MediaInfo { get; set; }
    /// <summary>Unix milliseconds (UTC) when the job was created. Used by clients for stable cross-device ordering.</summary>
    public long CreatedAt { get; set; }
}

public class StartJobResponseDto
{
    public string JobId { get; set; } = string.Empty;
}

public class CacheCheckResponseDto
{
    public bool Cached { get; set; }
    public string? JobId { get; set; }
}
