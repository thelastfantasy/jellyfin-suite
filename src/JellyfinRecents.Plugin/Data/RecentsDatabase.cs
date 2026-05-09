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
    private readonly ILogger<RecentsDatabase> _logger;

    public RecentsDatabase(string dbPath, ILogger<RecentsDatabase> logger)
    {
        _connectionString = $"Data Source={dbPath};Mode=ReadWriteCreate;Cache=Shared";
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

    // ── 版本控制 ─────────────────────────────────────────────────────────────

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
