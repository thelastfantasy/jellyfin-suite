namespace Jellyfin.Plugin.JellyfinRecents.Models;

public class PlayHistoryEntry
{
    public string ItemId { get; set; } = string.Empty;
    public DateTime PlayedDate { get; set; }
    public string? Title { get; set; }
    public string MediaType { get; set; } = "video";
    public DateTime? FavoritedAt { get; set; }
    public DateTime? ReleaseDate { get; set; }
    public DateTime? AddedDate { get; set; }
    public string? SeriesName { get; set; }
    public string? SeriesId { get; set; }
    public int? SeasonNumber { get; set; }
    public int? EpisodeNumber { get; set; }
    public string? ImagePrimaryTag { get; set; }
}

public class PlayHistoryResponse
{
    public List<PlayHistoryEntry> Entries { get; set; } = [];
    /// <summary>满足筛选条件的记录总数（去重敏感），用于前端计算 totalPages。</summary>
    public int TotalCount { get; set; }
}
