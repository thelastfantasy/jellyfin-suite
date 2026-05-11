using Jellyfin.Plugin.JellyfinRecents.Data;
using Jellyfin.Plugin.JellyfinRecents.Models;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.JellyfinRecents.Services;

public class PlayHistoryService
{
    private readonly RecentsDatabase _db;
    private readonly ILibraryManager _libraryManager;

    public PlayHistoryService(RecentsDatabase db, ILibraryManager libraryManager)
    {
        _db = db;
        _libraryManager = libraryManager;
    }

    public async Task<PlayHistoryResponse> GetPlayHistoryAsync(
        Guid userId, string groupBy, int page, string timeZoneId,
        string? mediaType, string sortBy, string sortOrder, bool showRepeats, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(groupBy)) groupBy = "week";
        var tz = GetTimeZone(timeZoneId);
        var nowUtc = DateTime.UtcNow;
        List<PlayHistoryEntry> entries;
        int totalPages;

        if (groupBy == "day")
        {
            // 按天：递补机制 — UTC 转本地日期，去重，按 30 天分页
            var tzOffset = (int)tz.GetUtcOffset(nowUtc).TotalMinutes;
            var dates = await _db.GetDistinctLocalDatesAsync(userId, tzOffset, ct);
            var pageDates = dates.Skip(page * 30).Take(30).ToList();
            totalPages = (int)Math.Ceiling(dates.Count / 30.0);

            if (pageDates.Count == 0)
                return new PlayHistoryResponse { Entries = [], TotalCount = 0, TotalPages = 0 };

            var minLocal = DateTime.Parse(pageDates[^1] + "T00:00:00");
            var maxLocal = DateTime.Parse(pageDates[0] + "T23:59:59.999");
            var utcStart = ConvertLocalToUtc(minLocal, tz);
            var utcEnd = ConvertLocalToUtc(maxLocal, tz);

            entries = await _db.GetPlayHistoryByDateRangeAsync(
                userId, utcStart, utcEnd, showRepeats, mediaType, sortBy, sortOrder, ct);

            var dateSet = new HashSet<string>(pageDates);
            entries = entries.Where(e =>
                dateSet.Contains(TimeZoneInfo.ConvertTimeFromUtc(e.PlayedDate, tz).ToString("yyyy-MM-dd"))).ToList();
        }
        else
        {
            var (utcStart, utcEnd) = ComputeWindow(groupBy, page, nowUtc, tz);
            entries = await _db.GetPlayHistoryByDateRangeAsync(
                userId, utcStart, utcEnd, showRepeats, mediaType, sortBy, sortOrder, ct);
            var earliest = await _db.GetEarliestPlayedAtAsync(userId, ct);
            totalPages = ComputeTotalPages(groupBy, nowUtc, tz, earliest);
        }

        EnrichMetadata(entries);

        return new PlayHistoryResponse { Entries = entries, TotalCount = entries.Count, TotalPages = totalPages };
    }

    private void EnrichMetadata(List<PlayHistoryEntry> entries)
    {
        foreach (var entry in entries)
        {
            if (!Guid.TryParse(entry.ItemId, out var itemGuid)) continue;
            var item = _libraryManager.GetItemById(itemGuid);
            if (item is null) continue;
            entry.Title = item.Name;
            entry.ReleaseDate = item.PremiereDate.HasValue ? item.PremiereDate.Value
                : item.ProductionYear.HasValue ? new DateTime(item.ProductionYear.Value, 1, 1, 0, 0, 0, DateTimeKind.Utc) : null;
            entry.AddedDate = item.DateCreated == DateTime.MinValue ? null : item.DateCreated;
            if (item is IHasSeries hasSeries && !string.IsNullOrEmpty(hasSeries.SeriesName))
            {
                entry.SeriesName = hasSeries.SeriesName;
                entry.SeriesId = hasSeries.SeriesId == Guid.Empty ? null : hasSeries.SeriesId.ToString("N");
            }
            entry.SeasonNumber = item.ParentIndexNumber;
            entry.EpisodeNumber = item.IndexNumber;
            entry.ImagePrimaryTag = null;
        }
    }

    // ─── 工具函数 ────────────────────────────────────────────────────────────

    private static TimeZoneInfo GetTimeZone(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch { return TimeZoneInfo.Utc; }
    }

    private static DateTime ConvertLocalToUtc(DateTime local, TimeZoneInfo tz)
    {
        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(unspecified, tz);
    }

    // ─── 固定窗口计算 ────────────────────────────────────────────────────────

    private static (DateTime utcStart, DateTime utcEnd) ComputeWindow(
        string groupBy, int page, DateTime nowUtc, TimeZoneInfo tz)
    {
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        DateTime localStart, localEnd;

        switch (groupBy)
        {
            case "week":
            {
                var weekOffset = page * 13;
                var dayOfWeek = (int)nowLocal.DayOfWeek;
                var mondayOffset = dayOfWeek == 0 ? -6 : 1 - dayOfWeek;
                var thisMonday = nowLocal.Date.AddDays(mondayOffset);
                localEnd = thisMonday.AddDays(-weekOffset * 7 + 6).AddDays(1).AddTicks(-1);
                localStart = thisMonday.AddDays(-(weekOffset + 12) * 7);
                break;
            }
            case "month":
            {
                var monthOffset = page * 6;
                var endMonth = nowLocal.Year * 12 + nowLocal.Month - 1 - monthOffset;
                var endYear = endMonth / 12; var endM = endMonth % 12 + 1;
                localEnd = new DateTime(endYear, endM, 1).AddMonths(1).AddTicks(-1);
                var startMonth = endMonth - 5;
                var startYear = startMonth / 12; var startM = startMonth % 12 + 1;
                localStart = new DateTime(startYear, startM, 1);
                break;
            }
            case "quarter":
            {
                var quarterOffset = page * 2;
                var currentQuarterEnd = ((nowLocal.Month - 1) / 3 + 1) * 3;
                var endMonthAbs = nowLocal.Year * 12 + currentQuarterEnd - 1 - quarterOffset * 3;
                var endYear = endMonthAbs / 12; var endM = endMonthAbs % 12 + 1;
                localEnd = new DateTime(endYear, endM, 1).AddMonths(1).AddTicks(-1);
                var startMonthAbs = endMonthAbs - 5;
                var startYear = startMonthAbs / 12; var startM = startMonthAbs % 12 + 1;
                localStart = new DateTime(startYear, startM, 1);
                break;
            }
            case "year":
            default:
            {
                localStart = new DateTime(nowLocal.Year - page, 1, 1);
                localEnd = new DateTime(nowLocal.Year - page, 12, 31, 23, 59, 59, 999);
                break;
            }
        }

        return (ConvertLocalToUtc(localStart, tz), ConvertLocalToUtc(localEnd, tz));
    }

    private static int ComputeTotalPages(
        string groupBy, DateTime nowUtc, TimeZoneInfo tz, DateTime? earliestUtc)
    {
        if (earliestUtc is null) return 0;
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var earliestLocal = TimeZoneInfo.ConvertTimeFromUtc(earliestUtc.Value, tz);

        switch (groupBy)
        {
            case "week":
            {
                var dow = (int)nowLocal.DayOfWeek;
                var thisMonday = nowLocal.Date.AddDays(dow == 0 ? -6 : 1 - dow);
                var earliestDow = (int)earliestLocal.DayOfWeek;
                var earliestMonday = earliestLocal.Date.AddDays(earliestDow == 0 ? -6 : 1 - earliestDow);
                return Math.Max(1, (int)Math.Ceiling((thisMonday - earliestMonday).Days / (13.0 * 7)));
            }
            case "month":
            {
                var totalMonths = (nowLocal.Year - earliestLocal.Year) * 12 + (nowLocal.Month - earliestLocal.Month);
                return Math.Max(1, (int)Math.Ceiling((totalMonths + 1) / 6.0));
            }
            case "quarter":
            {
                var totalMonths = (nowLocal.Year - earliestLocal.Year) * 12 + (nowLocal.Month - earliestLocal.Month);
                return Math.Max(1, (int)Math.Ceiling((totalMonths + 3) / 6.0));
            }
            default:
            {
                return Math.Max(1, nowLocal.Year - earliestLocal.Year + 1);
            }
        }
    }
}
