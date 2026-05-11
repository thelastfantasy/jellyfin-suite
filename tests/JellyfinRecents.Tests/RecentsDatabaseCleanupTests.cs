using Jellyfin.Plugin.JellyfinRecents.Data;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace JellyfinRecents.Tests;

public class RecentsDatabaseCleanupTests : IDisposable
{
    private readonly string _dbPath;
    private readonly RecentsDatabase _db;

    public RecentsDatabaseCleanupTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"jr_test_{Guid.NewGuid()}.db");
        var logger = Mock.Of<ILogger<RecentsDatabase>>();
        _db = new RecentsDatabase(_dbPath, logger);
        _db.Initialize();
    }

    public void Dispose()
    {
        try { File.Delete(_dbPath); } catch { }
        try { File.Delete(_dbPath + "-wal"); } catch { }
        try { File.Delete(_dbPath + "-shm"); } catch { }
    }

    private void InsertRecord(string userId, DateTime playedAt, string mediaType = "Video")
    {
        _db.InsertPlayRecord(Guid.Parse(userId), Guid.NewGuid().ToString(), playedAt, mediaType);
    }

    // ── DeleteExpiredRecordsAsync ──────────────────────────────────────────

    [Fact]
    public async Task DeleteExpiredRecordsAsync_DeletesOldRecords()
    {
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow.AddYears(-3));
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow.AddMonths(-6));

        var cutoff = DateTime.UtcNow.AddYears(-2);
        var deleted = await _db.DeleteExpiredRecordsAsync(cutoff, null, CancellationToken.None);

        Assert.Equal(1, deleted);
    }

    [Fact]
    public async Task DeleteExpiredRecordsAsync_AllRecent_DeletesNothing()
    {
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow.AddMonths(-1));
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow.AddDays(-1));

        var cutoff = DateTime.UtcNow.AddYears(-2);
        var deleted = await _db.DeleteExpiredRecordsAsync(cutoff, null, CancellationToken.None);

        Assert.Equal(0, deleted);
    }

    [Fact]
    public async Task DeleteExpiredRecordsAsync_EmptyTable_ReturnsZero()
    {
        var cutoff = DateTime.UtcNow.AddYears(-2);
        var deleted = await _db.DeleteExpiredRecordsAsync(cutoff, null, CancellationToken.None);
        Assert.Equal(0, deleted);
    }

    [Fact]
    public async Task DeleteExpiredRecordsAsync_MultipleUsers_DeletesAll()
    {
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow.AddYears(-3));
        InsertRecord("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", DateTime.UtcNow.AddYears(-4));

        var cutoff = DateTime.UtcNow.AddYears(-2);
        var deleted = await _db.DeleteExpiredRecordsAsync(cutoff, null, CancellationToken.None);

        Assert.Equal(2, deleted);
    }

    [Fact]
    public async Task DeleteExpiredRecordsAsync_SupportsCancellation()
    {
        for (var i = 0; i < 100; i++)
            InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow.AddYears(-3));

        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            _db.DeleteExpiredRecordsAsync(DateTime.UtcNow.AddYears(-2), null, cts.Token));
    }

    // ── DeletePerUserExcessAsync ───────────────────────────────────────────

    [Fact]
    public async Task DeletePerUserExcessAsync_UserExceedsLimit_DeletesExcess()
    {
        var uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        // Insert 15 records for user A
        for (var i = 0; i < 15; i++)
            InsertRecord(uid, DateTime.UtcNow.AddDays(-i));

        var deleted = await _db.DeletePerUserExcessAsync(10, null, CancellationToken.None);

        Assert.Equal(5, deleted);
    }

    [Fact]
    public async Task DeletePerUserExcessAsync_UserUnderLimit_DeletesNothing()
    {
        var uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        for (var i = 0; i < 5; i++)
            InsertRecord(uid, DateTime.UtcNow.AddDays(-i));

        var deleted = await _db.DeletePerUserExcessAsync(10, null, CancellationToken.None);

        Assert.Equal(0, deleted);
    }

    [Fact]
    public async Task DeletePerUserExcessAsync_MultipleUsers_MixedLimits()
    {
        var uidA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        var uidB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        for (var i = 0; i < 15; i++) InsertRecord(uidA, DateTime.UtcNow.AddDays(-i));
        for (var i = 0; i < 5; i++) InsertRecord(uidB, DateTime.UtcNow.AddDays(-i));

        var deleted = await _db.DeletePerUserExcessAsync(10, null, CancellationToken.None);

        Assert.Equal(5, deleted); // Only uidA exceeded limit
    }

    [Fact]
    public async Task DeletePerUserExcessAsync_ExactlyAtLimit_DeletesNothing()
    {
        var uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        for (var i = 0; i < 10; i++)
            InsertRecord(uid, DateTime.UtcNow.AddDays(-i));

        var deleted = await _db.DeletePerUserExcessAsync(10, null, CancellationToken.None);

        Assert.Equal(0, deleted);
    }

    [Fact]
    public async Task DeletePerUserExcessAsync_KeepsNewestRecords()
    {
        var uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        InsertRecord(uid, DateTime.UtcNow.AddDays(-100)); // Oldest → should be deleted
        for (var i = 0; i < 10; i++)
            InsertRecord(uid, DateTime.UtcNow.AddDays(-i)); // Newer 10 records

        await _db.DeletePerUserExcessAsync(10, null, CancellationToken.None);

        // Verify we can still query 10 records
        var (entries, count) = _db.GetPlayHistoryPage(
            Guid.Parse(uid), 0, 20, true, null, "playedDate", "desc");
        Assert.Equal(10, count);
    }

    // ── DeleteGlobalExcessAsync ────────────────────────────────────────────

    [Fact]
    public async Task DeleteGlobalExcessAsync_ExceedsLimit_DeletesExcess()
    {
        for (var i = 0; i < 50; i++)
            InsertRecord(Guid.NewGuid().ToString(), DateTime.UtcNow.AddDays(-i));

        var deleted = await _db.DeleteGlobalExcessAsync(30, null, CancellationToken.None);

        Assert.Equal(20, deleted);
    }

    [Fact]
    public async Task DeleteGlobalExcessAsync_UnderLimit_DeletesNothing()
    {
        for (var i = 0; i < 5; i++)
            InsertRecord(Guid.NewGuid().ToString(), DateTime.UtcNow.AddDays(-i));

        var deleted = await _db.DeleteGlobalExcessAsync(100, null, CancellationToken.None);

        Assert.Equal(0, deleted);
    }

    [Fact]
    public async Task DeleteGlobalExcessAsync_KeepsNewest()
    {
        InsertRecord(Guid.NewGuid().ToString(), DateTime.UtcNow.AddYears(-10));
        for (var i = 0; i < 10; i++)
            InsertRecord(Guid.NewGuid().ToString(), DateTime.UtcNow.AddDays(-i));

        var deleted = await _db.DeleteGlobalExcessAsync(10, null, CancellationToken.None);

        Assert.Equal(1, deleted); // Only the 10-year-old record deleted
    }

    // ── VacuumDatabaseAsync ────────────────────────────────────────────────

    [Fact]
    public async Task VacuumDatabaseAsync_ReturnsFileSizes()
    {
        for (var i = 0; i < 2000; i++)
            InsertRecord(Guid.NewGuid().ToString(), DateTime.UtcNow.AddDays(-i));

        var (before, after) = await _db.VacuumDatabaseAsync(null);

        Assert.True(before > 0);
        Assert.True(after > 0);
    }

    [Fact]
    public async Task VacuumDatabaseAsync_AfterDeletion_ReclaimsSpace()
    {
        for (var i = 0; i < 2000; i++)
            InsertRecord(Guid.NewGuid().ToString(), DateTime.UtcNow.AddDays(-i));

        // Delete most records to create free pages
        await _db.DeleteExpiredRecordsAsync(DateTime.UtcNow.AddDays(-500), null, CancellationToken.None);

        var (before, after) = await _db.VacuumDatabaseAsync(null);

        // After large deletion + VACUUM, file should shrink
        Assert.True(after <= before);
    }

    // ── GetDistinctUserIdsAsync / GetDistinctItemIdsAsync ─────────────────

    [Fact]
    public async Task GetDistinctUserIdsAsync_ReturnsAllUsers()
    {
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow);
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow.AddDays(-1));
        InsertRecord("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", DateTime.UtcNow);

        var ids = await _db.GetDistinctUserIdsAsync(CancellationToken.None);

        Assert.Equal(2, ids.Count);
        Assert.Contains("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", ids);
        Assert.Contains("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", ids);
    }

    [Fact]
    public async Task GetDistinctItemIdsAsync_ReturnsAllItems()
    {
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow);
        // Different items
        _db.InsertPlayRecord(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            "item-aaa", DateTime.UtcNow, "video");
        _db.InsertPlayRecord(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            "item-bbb", DateTime.UtcNow, "video");

        var ids = await _db.GetDistinctItemIdsAsync(CancellationToken.None);

        Assert.True(ids.Count >= 2);
    }

    // ── DeleteRecordsByFieldAsync ────────────────────────────────────────

    [Fact]
    public async Task DeleteRecordsByFieldAsync_DeletesMatching()
    {
        var uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        for (var i = 0; i < 5; i++)
            InsertRecord(uid, DateTime.UtcNow.AddDays(-i));

        var deleted = await _db.DeleteRecordsByFieldAsync("user_id",
            new HashSet<string> { uid }, null, CancellationToken.None);

        Assert.Equal(5, deleted);
    }

    [Fact]
    public async Task DeleteRecordsByFieldAsync_MultipleValues()
    {
        var uidA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        var uidB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        InsertRecord(uidA, DateTime.UtcNow);
        InsertRecord(uidA, DateTime.UtcNow.AddDays(-1));
        InsertRecord(uidB, DateTime.UtcNow);
        InsertRecord("cccccccc-cccc-cccc-cccc-cccccccccccc", DateTime.UtcNow);
        InsertRecord("cccccccc-cccc-cccc-cccc-cccccccccccc", DateTime.UtcNow.AddDays(-1));

        var deleted = await _db.DeleteRecordsByFieldAsync("user_id",
            new HashSet<string> { uidA, uidB }, null, CancellationToken.None);

        Assert.Equal(3, deleted); // 2 from A + 1 from B = 3
    }

    [Fact]
    public async Task DeleteRecordsByFieldAsync_EmptySet_ReturnsZero()
    {
        InsertRecord("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", DateTime.UtcNow);

        var deleted = await _db.DeleteRecordsByFieldAsync("user_id",
            new HashSet<string>(), null, CancellationToken.None);

        Assert.Equal(0, deleted);
    }
}
