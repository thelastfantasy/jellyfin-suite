using Jellyfin.Plugin.JellyfinRecents.Models;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Data;

/// <summary>
/// 管理插件的 SQLite 数据库（play_history + favorite_record 两张表）。
/// Schema 版本通过 PRAGMA user_version 控制，每次启动自动执行增量迁移。
/// </summary>
public class RecentsDatabase
{
    private const int CurrentSchemaVersion = 1;

    private readonly string _connectionString;
    private readonly string _dbPath;
    private readonly ILogger<RecentsDatabase> _logger;

    public RecentsDatabase(string dbPath, ILogger<RecentsDatabase> logger)
    {
        _connectionString = $"Data Source={dbPath};Mode=ReadWriteCreate;Cache=Shared";
        _dbPath = dbPath;
        _logger = logger;
    }

    /// <summary>
    /// 初始化数据库：WAL 模式 + 按版本号顺序执行增量迁移。
    /// </summary>
    public void Initialize()
    {
        using var conn = OpenConnection();

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "PRAGMA journal_mode=WAL;";
            cmd.ExecuteNonQuery();
        }

        var version = GetSchemaVersion(conn);
        _logger.LogInformation("RecentsDatabase schema version: {Version} → target: {Target}", version, CurrentSchemaVersion);

        if (version < 1) ApplyMigration1(conn);

        // 未来迁移在此追加：
        // if (version < 2) ApplyMigration2(conn);

        SetSchemaVersion(conn, CurrentSchemaVersion);
        _logger.LogInformation("RecentsDatabase ready at schema version {Version}", CurrentSchemaVersion);
    }

    // ── 迁移函数 ────────────────────────────────────────────────────────────

    /// <summary>Migration 1: 建初始表（play_history + favorite_record）。</summary>
    private static void ApplyMigration1(SqliteConnection conn)
    {
        using var tx = conn.BeginTransaction();
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS play_history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    TEXT    NOT NULL,
                item_id    TEXT    NOT NULL,
                played_at  TEXT    NOT NULL,
                media_type TEXT    NOT NULL DEFAULT 'video'
            );
            CREATE INDEX IF NOT EXISTS idx_ph_user_played ON play_history (user_id, played_at DESC);

            CREATE TABLE IF NOT EXISTS favorite_record (
                user_id      TEXT NOT NULL,
                item_id      TEXT NOT NULL,
                favorited_at TEXT,
                PRIMARY KEY (user_id, item_id)
            );
            """;
        cmd.ExecuteNonQuery();
        tx.Commit();
    }

    // ── 公共 CRUD ────────────────────────────────────────────────────────────

    /// <summary>插入一条播放开始记录。</summary>
    public void InsertPlayRecord(Guid userId, string itemId, DateTime playedAt, string mediaType)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO play_history (user_id, item_id, played_at, media_type)
            VALUES ($uid, $iid, $pat, $mt)
            """;
        cmd.Parameters.AddWithValue("$uid", userId.ToString());
        cmd.Parameters.AddWithValue("$iid", itemId);
        cmd.Parameters.AddWithValue("$pat", playedAt.ToUniversalTime().ToString("O"));
        cmd.Parameters.AddWithValue("$mt", mediaType);
        cmd.ExecuteNonQuery();
    }

    /// <summary>更新收藏记录：favoritedAt 有值表示已收藏，null 表示已取消收藏。</summary>
    public void UpsertFavorite(Guid userId, string itemId, DateTime? favoritedAt)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO favorite_record (user_id, item_id, favorited_at)
            VALUES ($uid, $iid, $fat)
            ON CONFLICT (user_id, item_id) DO UPDATE SET favorited_at = excluded.favorited_at
            """;
        cmd.Parameters.AddWithValue("$uid", userId.ToString());
        cmd.Parameters.AddWithValue("$iid", itemId);
        cmd.Parameters.AddWithValue("$fat", favoritedAt.HasValue
            ? (object)favoritedAt.Value.ToUniversalTime().ToString("O")
            : DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// 分页查询播放历史。当 showRepeats=false 时通过 GROUP BY 去重（每个 itemId 只保留最近一次）。
    /// sortBy 支持 "playedDate"（默认）和 "favoritedAt"；其余排序字段由调用方在内存中完成。
    /// </summary>
    public (List<PlayHistoryEntry> Entries, int TotalCount) GetPlayHistoryPage(
        Guid userId,
        int page,
        int pageSize,
        bool showRepeats,
        string? mediaType,
        string sortBy,
        string sortOrder)
    {
        var uid = userId.ToString();
        var offset = page * pageSize;
        var orderDir = string.Equals(sortOrder, "asc", StringComparison.OrdinalIgnoreCase) ? "ASC" : "DESC";
        var mediaFilter = string.IsNullOrEmpty(mediaType) ? string.Empty : " AND ph.media_type = $mt";

        // 排序列（只支持 DB 列；其余由上层内存排序）
        var orderCol = sortBy switch
        {
            "favoritedAt" => showRepeats
                ? $"(fr.favorited_at IS NULL), fr.favorited_at {orderDir}"
                : $"(MAX(fr.favorited_at) IS NULL), MAX(fr.favorited_at) {orderDir}",
            _ => showRepeats
                ? $"ph.played_at {orderDir}"
                : $"MAX(ph.played_at) {orderDir}",
        };

        string dataSql, countSql;

        if (showRepeats)
        {
            dataSql = $"""
                SELECT ph.item_id, ph.played_at, ph.media_type, fr.favorited_at
                FROM play_history ph
                LEFT JOIN favorite_record fr ON fr.user_id = ph.user_id AND fr.item_id = ph.item_id
                WHERE ph.user_id = $uid{mediaFilter}
                ORDER BY {orderCol}
                LIMIT $pageSize OFFSET $offset
                """;
            countSql = $"SELECT COUNT(*) FROM play_history ph WHERE ph.user_id = $uid{mediaFilter}";
        }
        else
        {
            dataSql = $"""
                SELECT ph.item_id, MAX(ph.played_at) AS played_at, ph.media_type, MAX(fr.favorited_at) AS favorited_at
                FROM play_history ph
                LEFT JOIN favorite_record fr ON fr.user_id = ph.user_id AND fr.item_id = ph.item_id
                WHERE ph.user_id = $uid{mediaFilter}
                GROUP BY ph.item_id
                ORDER BY {orderCol}
                LIMIT $pageSize OFFSET $offset
                """;
            countSql = $"SELECT COUNT(DISTINCT ph.item_id) FROM play_history ph WHERE ph.user_id = $uid{mediaFilter}";
        }

        using var conn = OpenConnection();

        // 总数
        using var countCmd = conn.CreateCommand();
        countCmd.CommandText = countSql;
        countCmd.Parameters.AddWithValue("$uid", uid);
        if (!string.IsNullOrEmpty(mediaType)) countCmd.Parameters.AddWithValue("$mt", mediaType);
        var totalCount = Convert.ToInt32(countCmd.ExecuteScalar());

        // 分页数据
        using var dataCmd = conn.CreateCommand();
        dataCmd.CommandText = dataSql;
        dataCmd.Parameters.AddWithValue("$uid", uid);
        dataCmd.Parameters.AddWithValue("$pageSize", pageSize);
        dataCmd.Parameters.AddWithValue("$offset", offset);
        if (!string.IsNullOrEmpty(mediaType)) dataCmd.Parameters.AddWithValue("$mt", mediaType);

        var entries = new List<PlayHistoryEntry>();
        using var reader = dataCmd.ExecuteReader();
        while (reader.Read())
        {
            var favStr = reader.IsDBNull(3) ? null : reader.GetString(3);
            entries.Add(new PlayHistoryEntry
            {
                ItemId = reader.GetString(0),
                PlayedDate = DateTime.Parse(reader.GetString(1), null, System.Globalization.DateTimeStyles.RoundtripKind),
                MediaType = reader.GetString(2),
                FavoritedAt = favStr is not null
                    ? DateTime.Parse(favStr, null, System.Globalization.DateTimeStyles.RoundtripKind)
                    : null,
            });
        }

        return (entries, totalCount);
    }

    // ── 数据库维护 ────────────────────────────────────────────────────────────

    private const int CleanupBatchSize = 1000;

    /// <summary>批量删除 played_at &lt; cutoff 的所有记录（任务 1）。</summary>
    public async Task<int> DeleteExpiredRecordsAsync(DateTime cutoff, IProgress<double>? progress, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        progress?.Report(0);

        var totalDeleted = 0;

        // 先获取待删除行数用于进度计算
        await using (var cntConn = OpenConnection())
        {
            await using var cntCmd = cntConn.CreateCommand();
            cntCmd.CommandText = "SELECT COUNT(*) FROM play_history WHERE played_at < @cutoff";
            cntCmd.Parameters.AddWithValue("@cutoff", cutoff.ToUniversalTime().ToString("O"));
            var total = Convert.ToInt32(await cntCmd.ExecuteScalarAsync(ct));
            if (total == 0)
            {
                progress?.Report(100);
                return 0;
            }

            await using var conn = OpenConnection();
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    DELETE FROM play_history WHERE rowid IN (
                        SELECT rowid FROM play_history WHERE played_at < @cutoff LIMIT @batch
                    )
                    """;
                cmd.Parameters.AddWithValue("@cutoff", cutoff.ToUniversalTime().ToString("O"));
                cmd.Parameters.AddWithValue("@batch", CleanupBatchSize);
                var deleted = await cmd.ExecuteNonQueryAsync(ct);
                if (deleted == 0) break;
                totalDeleted += deleted;
                progress?.Report(Math.Min(100, (double)totalDeleted / total * 100));
            }
        }

        progress?.Report(100);
        _logger.LogInformation("DeleteExpiredRecords: {Count} records deleted before {Cutoff:O}", totalDeleted, cutoff);
        return totalDeleted;
    }

    /// <summary>逐用户删除超出 maxRecords 条的最旧记录（任务 2）。</summary>
    public async Task<int> DeletePerUserExcessAsync(int maxRecords, IProgress<double>? progress, CancellationToken ct)
    {
        var totalDeleted = 0;
        progress?.Report(0);

        // 获取所有有记录的用户
        var userIds = new List<string>();
        await using (var conn = OpenConnection())
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT DISTINCT user_id FROM play_history";
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                userIds.Add(reader.GetString(0));
        }

        if (userIds.Count == 0)
        {
            progress?.Report(100);
            return 0;
        }

        var processed = 0;
        foreach (var uid in userIds)
        {
            ct.ThrowIfCancellationRequested();
            var userDeleted = 0;
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                await using var conn = OpenConnection();
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    DELETE FROM play_history WHERE rowid IN (
                        SELECT rowid FROM play_history WHERE user_id = @uid
                        ORDER BY played_at DESC LIMIT @batch OFFSET @max
                    )
                    """;
                cmd.Parameters.AddWithValue("@uid", uid);
                cmd.Parameters.AddWithValue("@max", maxRecords);
                cmd.Parameters.AddWithValue("@batch", CleanupBatchSize);
                var deleted = await cmd.ExecuteNonQueryAsync(ct);
                if (deleted == 0) break;
                userDeleted += deleted;
            }
            totalDeleted += userDeleted;
            processed++;
            progress?.Report(Math.Min(100, (double)processed / userIds.Count * 100));
        }

        progress?.Report(100);
        _logger.LogInformation("DeletePerUserExcess: {Count} records deleted across {Users} users (max {Max} each)", totalDeleted, userIds.Count, maxRecords);
        return totalDeleted;
    }

    /// <summary>全表仅保留最新 maxRecords 条记录（任务 3）。</summary>
    public async Task<int> DeleteGlobalExcessAsync(int maxRecords, IProgress<double>? progress, CancellationToken ct)
    {
        var totalDeleted = 0;
        progress?.Report(0);

        // 先获取待删除行数用于进度计算
        await using (var cntConn = OpenConnection())
        {
            await using var cntCmd = cntConn.CreateCommand();
            cntCmd.CommandText = "SELECT COUNT(*) FROM play_history";
            var total = Convert.ToInt32(await cntCmd.ExecuteScalarAsync(ct));
            var excess = total > maxRecords ? total - maxRecords : 0;
            if (excess == 0)
            {
                progress?.Report(100);
                return 0;
            }

            await using var conn = OpenConnection();
            while (totalDeleted < excess)
            {
                ct.ThrowIfCancellationRequested();
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    DELETE FROM play_history WHERE rowid IN (
                        SELECT rowid FROM play_history ORDER BY played_at DESC LIMIT @batch OFFSET @max
                    )
                    """;
                cmd.Parameters.AddWithValue("@max", maxRecords);
                cmd.Parameters.AddWithValue("@batch", CleanupBatchSize);
                var deleted = await cmd.ExecuteNonQueryAsync(ct);
                if (deleted == 0) break;
                totalDeleted += deleted;
                progress?.Report(Math.Min(100, (double)totalDeleted / excess * 100));
            }
        }

        progress?.Report(100);
        _logger.LogInformation("DeleteGlobalExcess: {Count} records deleted (keeping latest {Max})", totalDeleted, maxRecords);
        return totalDeleted;
    }

    /// <summary>执行 VACUUM 重建数据库文件并返回优化前后文件大小（任务 4）。</summary>
    public async Task<(long BeforeSize, long AfterSize)> VacuumDatabaseAsync(IProgress<double>? progress)
    {
        progress?.Report(0);
        var beforeSize = new FileInfo(_dbPath).Length;

        await using var conn = OpenConnection();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "VACUUM";
        await cmd.ExecuteNonQueryAsync();

        var afterSize = new FileInfo(_dbPath).Length;
        progress?.Report(100);
        _logger.LogInformation("VACUUM: {Before} → {After} bytes (saved {Saved})", beforeSize, afterSize, beforeSize - afterSize);
        return (beforeSize, afterSize);
    }

    /// <summary>获取所有不重复的 user_id（任务 5 用）。</summary>
    public async Task<List<string>> GetDistinctUserIdsAsync(CancellationToken ct)
    {
        var ids = new List<string>();
        await using var conn = OpenConnection();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT DISTINCT user_id FROM play_history";
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            ids.Add(reader.GetString(0));
        return ids;
    }

    /// <summary>获取所有不重复的 item_id（任务 5 用）。</summary>
    public async Task<List<string>> GetDistinctItemIdsAsync(CancellationToken ct)
    {
        var ids = new List<string>();
        await using var conn = OpenConnection();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT DISTINCT item_id FROM play_history";
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            ids.Add(reader.GetString(0));
        return ids;
    }

    /// <summary>按字段值批量删除记录（任务 5 用）。field 必须为 user_id 或 item_id。</summary>
    public async Task<int> DeleteRecordsByFieldAsync(string field, HashSet<string> values, IProgress<double>? progress, CancellationToken ct)
    {
        var totalDeleted = 0;
        var total = values.Count;
        var processed = 0;
        progress?.Report(0);

        foreach (var val in values)
        {
            ct.ThrowIfCancellationRequested();
            await using var conn = OpenConnection();
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = $"""
                    DELETE FROM play_history WHERE rowid IN (
                        SELECT rowid FROM play_history WHERE {field} = @val LIMIT @batch
                    )
                    """;
                cmd.Parameters.AddWithValue("@val", val);
                cmd.Parameters.AddWithValue("@batch", CleanupBatchSize);
                var deleted = await cmd.ExecuteNonQueryAsync(ct);
                if (deleted == 0) break;
                totalDeleted += deleted;
            }
            processed++;
            if (total > 0)
                progress?.Report(Math.Min(100, (double)processed / total * 100));
        }

        progress?.Report(100);
        _logger.LogInformation("DeleteRecordsByField({Field}): {Count} records deleted across {Total} values", field, totalDeleted, total);
        return totalDeleted;
    }

    private static int GetSchemaVersion(SqliteConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return Convert.ToInt32(cmd.ExecuteScalar());
    }

    private static void SetSchemaVersion(SqliteConnection conn, int version)
    {
        using var cmd = conn.CreateCommand();
        // PRAGMA 不支持参数绑定，version 是内部常量，无注入风险
        cmd.CommandText = $"PRAGMA user_version = {version};";
        cmd.ExecuteNonQuery();
    }

    private SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }
}
