namespace Jellyfin.Plugin.JellyfinRecents.Models;

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
