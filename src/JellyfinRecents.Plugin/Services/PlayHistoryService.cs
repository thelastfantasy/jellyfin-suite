using Jellyfin.Plugin.JellyfinRecents.Data;
using Jellyfin.Plugin.JellyfinRecents.Models;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.JellyfinRecents.Services;

/// <summary>
/// 从插件 SQLite 数据库查询播放历史，并通过 ILibraryManager 补充实时元数据（标题、发行年份等）。
/// </summary>
public class PlayHistoryService
{
    private readonly RecentsDatabase _db;
    private readonly ILibraryManager _libraryManager;

    public PlayHistoryService(RecentsDatabase db, ILibraryManager libraryManager)
    {
        _db = db;
        _libraryManager = libraryManager;
    }

    public Task<PlayHistoryResponse> GetPlayHistoryAsync(
        Guid userId,
        int page,
        int pageSize,
        bool showRepeats,
        string? mediaType,
        string sortBy,
        string sortOrder)
    {
        var (entries, totalCount) = _db.GetPlayHistoryPage(
            userId, page, pageSize, showRepeats, mediaType, sortBy, sortOrder);

        // 批量从媒体库取实时元数据（title 永远最新，同时填充 releaseYear / addedDate）
        foreach (var entry in entries)
        {
            if (!Guid.TryParse(entry.ItemId, out var itemGuid)) continue;
            var item = _libraryManager.GetItemById(itemGuid);
            if (item is null) continue;

            entry.Title = item.Name;
            entry.ReleaseDate = item.PremiereDate.HasValue
                ? item.PremiereDate.Value
                : item.ProductionYear.HasValue
                    ? new DateTime(item.ProductionYear.Value, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                    : null;
            entry.AddedDate = item.DateCreated == DateTime.MinValue ? null : item.DateCreated;
            if (item is IHasSeries hasSeries && !string.IsNullOrEmpty(hasSeries.SeriesName))
            {
                entry.SeriesName = hasSeries.SeriesName;
                entry.SeriesId = hasSeries.SeriesId == Guid.Empty ? null : hasSeries.SeriesId.ToString("N");
            }
            entry.SeasonNumber = item.ParentIndexNumber;
            entry.EpisodeNumber = item.IndexNumber;
            // ItemImageInfo 无 Tag 属性；前端直接用无 tag 的图片 URL，Jellyfin 仍可正确返回图片
            entry.ImagePrimaryTag = null;
        }

        return Task.FromResult(new PlayHistoryResponse
        {
            Entries = entries,
            TotalCount = totalCount,
        });
    }
}
