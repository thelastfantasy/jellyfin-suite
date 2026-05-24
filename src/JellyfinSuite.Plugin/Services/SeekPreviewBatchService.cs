using System.Threading.Channels;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinSuite.Services;

/// <summary>
/// Persistent background service that drives seek-preview frame generation
/// with a 4-level priority queue across multiple videos:
///   0 = current video, within ±3 min of current playback position
///   1 = current video, other frames
///   2 = previously played video, within ±3 min of last known position
///   3 = previously played video, other frames
///
/// Batch work continues even after the SSE stream disconnects.
/// </summary>
public sealed class SeekPreviewBatchService : BackgroundService
{
    private const long NearRangeMs = 3 * 60_000L;
    private const int PrefetchBatchSize = 5; // matches Rust MAX_CONCURRENT_PREFETCH
    private const int PollIntervalMs = 500;
    private const int DefaultWidth = 320;

    private readonly record struct BatchFrame(string ItemId, string FilePath, long PosMs);

    private readonly SeekPreviewService _seekPreview;
    private readonly ILogger<SeekPreviewBatchService> _logger;

    // Pending frames — protected by _lock
    private readonly List<BatchFrame> _pending = [];
    private readonly HashSet<(string, long)> _pendingKeys = [];

    // Priority state — protected by _lock
    private string? _activeItemId;
    private long _activePositionMs;
    private readonly Dictionary<string, long> _lastPos = [];
    private readonly Dictionary<string, (long posMs, DateTime time)> _posThrottle = [];

    // Per-frame dispatch priority tracking (for batch completion stats) — protected by _lock
    private readonly Dictionary<(string, long), int> _dispatchPriority = [];
    // Per-item batch stats: start time + frames completed at each priority — protected by _lock
    private readonly Dictionary<string, (DateTime Start, int[] ByPriority)> _batchStats = [];
    // Last dominant priority key for shift detection — protected by _lock
    private string? _lastDominantKey;

    // SSE notification channels — protected by _subsLock
    private readonly Dictionary<string, List<Channel<long>>> _subs = [];
    private readonly object _subsLock = new();

    private readonly object _lock = new();

    public SeekPreviewBatchService(SeekPreviewService seekPreview, ILogger<SeekPreviewBatchService> logger)
    {
        _seekPreview = seekPreview;
        _logger = logger;
    }

    /// <summary>Declare a new video as currently active and set its priority center.</summary>
    public void SetActive(string itemId, long positionMs)
    {
        lock (_lock)
        {
            if (_activeItemId != null && _activeItemId != itemId)
                _lastPos[_activeItemId] = _activePositionMs;

            _activeItemId = itemId;
            _activePositionMs = positionMs;
            _lastPos[itemId] = positionMs;
        }
        _logger.LogInformation("[seek-preview] active → {ItemId} @ {PosSec}s (priority center: ±3 min)",
            itemId[..8], positionMs / 1000);
    }

    /// <summary>
    /// Update the playback position for an active item (from progress events).
    /// Throttled: only propagates if position moved &gt;1 min or &gt;60 s have elapsed.
    /// </summary>
    public void UpdatePosition(string itemId, long positionMs)
    {
        lock (_lock)
        {
            if (_posThrottle.TryGetValue(itemId, out var last))
            {
                var movedFar = Math.Abs(positionMs - last.posMs) > 60_000;
                var enoughTime = (DateTime.UtcNow - last.time).TotalSeconds > 60;
                if (!movedFar && !enoughTime) return;
            }
            _posThrottle[itemId] = (positionMs, DateTime.UtcNow);
            _lastPos[itemId] = positionMs;
            if (itemId == _activeItemId)
                _activePositionMs = positionMs;
        }
        _logger.LogInformation("[seek-preview] position → {ItemId} @ {PosSec}s", itemId[..8], positionMs / 1000);
    }

    /// <summary>
    /// Enqueue all 30 s-aligned frames for an item.
    /// Frames already on disk or already queued are skipped.
    /// </summary>
    public void Enqueue(string itemId, string filePath, long durationMs)
    {
        var added = 0;
        lock (_lock)
        {
            for (var ms = 0L; ms <= durationMs; ms += 30_000)
            {
                if (IsOnDisk(itemId, ms)) continue;
                if (_pendingKeys.Add((itemId, ms)))
                {
                    _pending.Add(new BatchFrame(itemId, filePath, ms));
                    added++;
                }
            }
        }

        if (added > 0)
        {
            if (!_batchStats.ContainsKey(itemId))
                _batchStats[itemId] = (DateTime.UtcNow, new int[4]);
            _logger.LogInformation("[seek-preview] enqueued {Added} frames for {ItemId} (total pending: {Total})",
                added, itemId, _pending.Count);
        }
    }

    /// <summary>
    /// Subscribe to frame-ready notifications for an item.
    /// Frames already on disk are NOT sent retroactively — scan disk first in ReadyStream.
    /// Dispose the returned token to unsubscribe.
    /// </summary>
    public (Channel<long> Channel, IDisposable Unsubscribe) Subscribe(string itemId)
    {
        var ch = Channel.CreateUnbounded<long>(new UnboundedChannelOptions { SingleReader = true });
        lock (_subsLock)
        {
            if (!_subs.TryGetValue(itemId, out var list))
                _subs[itemId] = list = [];
            list.Add(ch);
        }
        return (ch, new Unsubscriber(this, itemId, ch));
    }

    private void Unsubscribe(string itemId, Channel<long> ch)
    {
        lock (_subsLock)
        {
            if (!_subs.TryGetValue(itemId, out var list)) return;
            list.Remove(ch);
            if (list.Count == 0) _subs.Remove(itemId);
        }
        ch.Writer.TryComplete();
    }

    /// <returns>Whether there are pending frames for this item.</returns>
    public bool HasPending(string itemId)
    {
        lock (_lock)
            return _pending.Any(f => f.ItemId == itemId);
    }

    private int CalcPriority(string itemId, long posMs)
    {
        bool isCurrent = itemId == _activeItemId;
        var refPos = _lastPos.GetValueOrDefault(itemId, 0L);
        bool isNear = Math.Abs(posMs - refPos) <= NearRangeMs;

        return (isCurrent, isNear) switch
        {
            (true, true) => 0,
            (true, false) => 1,
            (false, true) => 2,
            _ => 3,
        };
    }

    private static bool IsOnDisk(string itemId, long posMs) =>
        File.Exists(Path.Combine(SeekPreviewService.CacheDirectory, itemId, $"{posMs}.jpg"));

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Start the Rust daemon eagerly so the first SSE connection is instant.
        if (_seekPreview.IsAvailable)
        {
            try { await _seekPreview.EnsureStartedAsync(ct); }
            catch (Exception ex) { _logger.LogWarning(ex, "[seek-preview] eager daemon start failed, will retry on first request"); }
        }

        while (!ct.IsCancellationRequested)
        {
            try { await TickAsync(ct); }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) { _logger.LogError(ex, "[seek-preview] batch worker error"); }

            try { await Task.Delay(PollIntervalMs, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    private Task TickAsync(CancellationToken _)
    {
        List<BatchFrame> done;
        List<(BatchFrame Frame, int Priority)> toSend;
        List<string> completedItems;
        List<(string ItemId, DateTime Start, int[] ByPriority)> completedStats;
        string? priorityShiftFrom = null, priorityShiftTo = null;

        lock (_lock)
        {
            if (_pending.Count == 0) return Task.CompletedTask;

            done = _pending.Where(f => IsOnDisk(f.ItemId, f.PosMs)).ToList();
            foreach (var f in done)
            {
                _pending.Remove(f);
                _pendingKeys.Remove((f.ItemId, f.PosMs));
                // Record completion at the priority it was dispatched at
                if (_dispatchPriority.TryGetValue((f.ItemId, f.PosMs), out var p))
                {
                    _dispatchPriority.Remove((f.ItemId, f.PosMs));
                    if (_batchStats.TryGetValue(f.ItemId, out var stats))
                        stats.ByPriority[p]++;
                }
            }

            completedItems = done
                .Select(f => f.ItemId)
                .Distinct()
                .Where(id => !_pending.Any(f => f.ItemId == id))
                .ToList();

            // Snapshot stats for completed items before clearing
            completedStats = completedItems
                .Where(id => _batchStats.ContainsKey(id))
                .Select(id => (id, _batchStats[id].Start, _batchStats[id].ByPriority))
                .ToList();
            foreach (var id in completedItems) _batchStats.Remove(id);

            // Build toSend with pre-computed priority (avoids double-computing outside lock)
            toSend = _pending
                .Select(f => (Frame: f, Priority: CalcPriority(f.ItemId, f.PosMs)))
                .OrderBy(x => x.Priority)
                .ThenBy(x => Math.Abs(x.Frame.PosMs - _lastPos.GetValueOrDefault(x.Frame.ItemId, 0L)))
                .Take(PrefetchBatchSize)
                .ToList();

            // Record dispatch priority and detect dominant shift
            foreach (var (f, p) in toSend)
            {
                _dispatchPriority[(f.ItemId, f.PosMs)] = p;
                _logger.LogDebug("[seek-preview] dispatch p{P} {Id}@{Ms}ms active={Active}",
                    p, f.ItemId[..8], f.PosMs, f.ItemId == _activeItemId);
            }

            var newKey = toSend.Count > 0 ? $"{toSend[0].Frame.ItemId[..8]}:p{toSend[0].Priority}" : null;
            if (newKey != _lastDominantKey)
            {
                priorityShiftFrom = _lastDominantKey;
                priorityShiftTo = newKey;
                _lastDominantKey = newKey;
            }
        }

        // Notify subscribers (outside lock)
        if (done.Count > 0)
        {
            lock (_subsLock)
            {
                foreach (var grp in done.GroupBy(f => f.ItemId))
                {
                    if (!_subs.TryGetValue(grp.Key, out var channels)) continue;
                    foreach (var ch in channels)
                        foreach (var f in grp)
                            ch.Writer.TryWrite(f.PosMs);
                }

                foreach (var id in completedItems)
                {
                    if (!_subs.TryGetValue(id, out var channels)) continue;
                    foreach (var ch in channels)
                        ch.Writer.TryComplete();
                    _subs.Remove(id);
                }
            }
        }

        // Log batch completion with priority breakdown
        foreach (var (id, start, byPriority) in completedStats)
        {
            var elapsed = (DateTime.UtcNow - start).TotalSeconds;
            var total = byPriority.Sum();
            _logger.LogInformation(
                "[seek-preview] batch done {ItemId}: {Total} frames in {Sec:F0}s [p0:{P0} p1:{P1} p2:{P2} p3:{P3}]",
                id[..8], total, elapsed, byPriority[0], byPriority[1], byPriority[2], byPriority[3]);
        }

        // Log priority shift (dominant frame changed priority level)
        if (priorityShiftTo != null)
            _logger.LogInformation("[seek-preview] priority → {From} → {To}",
                priorityShiftFrom ?? "idle", priorityShiftTo);

        // Send prefetch requests
        if (!_seekPreview.IsAvailable) return Task.CompletedTask;

        if (toSend.Count > 0)
        {
            // Tick detail demoted to Debug; only log when frames actually completed this tick
            if (done.Count > 0)
            {
                var breakdown = toSend
                    .GroupBy(x => x.Priority)
                    .OrderBy(g => g.Key)
                    .Select(g => $"p{g.Key}:{g.Count()}");
                _logger.LogInformation("[seek-preview] tick +{Done} send={Count} [{Breakdown}] pending={Pending}",
                    done.Count, toSend.Count, string.Join(" ", breakdown), _pending.Count);
            }

            foreach (var (f, _) in toSend)
            {
                if (Guid.TryParseExact(f.ItemId, "N", out var guid))
                    _seekPreview.Prefetch(f.FilePath, f.PosMs, DefaultWidth, guid);
            }
        }

        return Task.CompletedTask;
    }

    private sealed class Unsubscriber : IDisposable
    {
        private readonly SeekPreviewBatchService _svc;
        private readonly string _itemId;
        private readonly Channel<long> _ch;
        private bool _disposed;

        public Unsubscriber(SeekPreviewBatchService svc, string itemId, Channel<long> ch)
        {
            _svc = svc;
            _itemId = itemId;
            _ch = ch;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _svc.Unsubscribe(_itemId, _ch);
        }
    }
}
