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
    public bool HasAncestors { get; set; }
    public long? PlaybackPositionTicks { get; set; }
    public double? VideoDuration { get; set; }  // RunTimeTicks / 10_000_000, null for audio
}

public class PlayHistoryResponse
{
    public List<PlayHistoryEntry> Entries { get; set; } = [];
    public int TotalCount { get; set; }
    public int TotalPages { get; set; }
}
