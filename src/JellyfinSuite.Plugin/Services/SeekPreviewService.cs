using System.Buffers.Binary;
using System.Diagnostics;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinSuite.Services;

/// <summary>
/// Manages the seek-preview Rust daemon and provides FETCH/PREFETCH frame requests.
/// Maintains two separate Unix socket connections so PREFETCH never blocks FETCH.
/// </summary>
public sealed class SeekPreviewService : IDisposable
{
    private const string BinaryName = "seek-preview-linux-x64";

    /// <summary>Disk cache root written by the Rust daemon. C# polls this for SSE readiness.</summary>
    public static string CacheDirectory => Path.Combine(Path.GetTempPath(), "seek-preview");

    private readonly ILogger<SeekPreviewService> _logger;

    private readonly string _socketPath;
    private readonly string _binaryPath;

    private Process? _process;

    // Guards EnsureStartedAsync against concurrent daemon launches
    private readonly SemaphoreSlim _startLock = new(1, 1);

    // FETCH connection: one request at a time, protected by semaphore
    private Socket? _fetchSocket;
    private readonly SemaphoreSlim _fetchLock = new(1, 1);

    // PREFETCH connection: fire-and-forget, no synchronization needed
    private Socket? _prefetchSocket;
    private readonly SemaphoreSlim _prefetchConnLock = new(1, 1);

    private uint _nextRequestId;
    private bool _disposed;

    public SeekPreviewService(IApplicationPaths appPaths, ILogger<SeekPreviewService> logger)
    {
        _logger = logger;
        _socketPath = Path.Combine(appPaths.DataPath, "jfs-seek-preview.sock");
        var dir = Path.GetDirectoryName(typeof(SeekPreviewService).Assembly.Location)!;
        _binaryPath = Path.Combine(dir, BinaryName);
    }

    public bool IsAvailable => RuntimeInformation.IsOSPlatform(OSPlatform.Linux)
                               && File.Exists(_binaryPath);

    public async Task EnsureStartedAsync(CancellationToken ct = default)
    {
        if (!IsAvailable) return;
        // Fast path: daemon running AND both sockets healthy.
        if (_process is { HasExited: false } && _fetchSocket != null && _prefetchSocket != null) return;

        await _startLock.WaitAsync(ct);
        try
        {
            if (_process is { HasExited: false })
            {
                // Daemon is still running but one or both sockets were reset after an error.
                // Reconnect them without restarting the daemon.
                if (_fetchSocket == null)
                    _fetchSocket = await ConnectUnixSocketAsync(ct);
                if (_prefetchSocket == null)
                    _prefetchSocket = await ConnectUnixSocketAsync(ct);
                return;
            }
            if (File.Exists(_socketPath))
                File.Delete(_socketPath);

            try { File.SetUnixFileMode(_binaryPath, UnixFileMode.UserRead | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute); }
            catch { /* non-Unix or permission denied — proceed anyway */ }

            var psi = new System.Diagnostics.ProcessStartInfo("nice", $"-n 10 \"{_binaryPath}\" \"{_socketPath}\"")
            {
                UseShellExecute = false,
                RedirectStandardError = true,
            };

            psi.Environment["LD_LIBRARY_PATH"] = "/usr/lib/jellyfin-ffmpeg/lib";

            _process = System.Diagnostics.Process.Start(psi);
            if (_process == null)
            {
                _logger.LogWarning("[SeekPreview] Failed to start seek-preview daemon");
                return;
            }

            _ = Task.Run(async () =>
            {
                string? line;
                while ((line = await _process.StandardError.ReadLineAsync()) != null)
                    _logger.LogInformation("{Line}", line);
            }, ct);

            for (var i = 0; i < 50 && !File.Exists(_socketPath); i++)
                await Task.Delay(100, ct);

            if (!File.Exists(_socketPath))
            {
                _logger.LogWarning("[SeekPreview] Daemon started but socket not created");
                return;
            }

            _fetchSocket = await ConnectUnixSocketAsync(ct);
            _prefetchSocket = await ConnectUnixSocketAsync(ct);

            _logger.LogInformation("[SeekPreview] Daemon ready at {Path}", _socketPath);

            _ = Task.Run(async () =>
            {
                await _process.WaitForExitAsync(CancellationToken.None);
                _logger.LogWarning("[SeekPreview] Daemon exited — restarting in 3s");
                await Task.Delay(3000, CancellationToken.None);
                await EnsureStartedAsync(CancellationToken.None);
            }, CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[SeekPreview] Failed to start daemon");
        }
        finally
        {
            _startLock.Release();
        }
    }

    private async Task<Socket> ConnectUnixSocketAsync(CancellationToken ct)
    {
        var sock = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        var ep = new UnixDomainSocketEndPoint(_socketPath);
        await sock.ConnectAsync(ep, ct);
        return sock;
    }

    /// <summary>Fetches a JPEG frame for the given item at pos_ms. Returns null on failure.</summary>
    public async Task<byte[]?> FetchAsync(
        string filePath, long posMs, int width, Guid itemId, CancellationToken ct = default)
    {
        if (_fetchSocket == null) return null;

        await _fetchLock.WaitAsync(ct);
        try
        {
            var id = Interlocked.Increment(ref _nextRequestId);
            await SendRequestAsync(_fetchSocket, 0x01, id, posMs, width, filePath, itemId, ct);
            return await ReceiveResponseAsync(_fetchSocket, id, ct);
        }
        catch (Exception ex)
        {
            // If the request was cancelled after the Rust daemon already processed it and sent a
            // response, that response is now stuck in the socket buffer. The next call would read
            // the wrong frame. Dispose and null the socket so EnsureStartedAsync reconnects fresh.
            try { _fetchSocket?.Dispose(); } catch { }
            _fetchSocket = null;

            if (ex is OperationCanceledException) throw;
            _logger.LogDebug(ex, "[SeekPreview] FetchAsync error — socket reset");
            return null;
        }
        finally
        {
            _fetchLock.Release();
        }
    }

    /// <summary>Sends a prefetch hint. Fire-and-forget — never blocks the caller.</summary>
    public void Prefetch(string filePath, long posMs, int width, Guid itemId)
    {
        if (_prefetchSocket == null) return;

        _ = Task.Run(async () =>
        {
            await _prefetchConnLock.WaitAsync();
            try
            {
                var id = Interlocked.Increment(ref _nextRequestId);
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await SendRequestAsync(_prefetchSocket, 0x02, id, posMs, width, filePath, itemId, cts.Token);
                var buf = new byte[8];
                _ = await ReceiveBytesAsync(_prefetchSocket, buf, cts.Token);
            }
            catch
            {
                // Prefetch is best-effort. On error, reset the socket so the buffer
                // doesn't accumulate stale ACKs that would desync subsequent requests.
                try { _prefetchSocket?.Dispose(); } catch { }
                _prefetchSocket = null;
            }
            finally
            {
                _prefetchConnLock.Release();
            }
        });
    }

    private static async Task SendRequestAsync(
        Socket sock,
        byte priority, uint requestId, long posMs, int width,
        string filePath, Guid itemId, CancellationToken ct)
    {
        var pathBytes = System.Text.Encoding.UTF8.GetBytes(filePath);
        var itemIdBytes = System.Text.Encoding.ASCII.GetBytes(itemId.ToString("N")); // always 32 bytes
        // 1 + 4 + 8 + 4 + 4 + N + 32
        var buf = new byte[21 + pathBytes.Length + 32];
        buf[0] = priority;
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(1), requestId);
        BinaryPrimitives.WriteInt64LittleEndian(buf.AsSpan(5), posMs);
        BinaryPrimitives.WriteInt32LittleEndian(buf.AsSpan(13), width);
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(17), (uint)pathBytes.Length);
        pathBytes.CopyTo(buf, 21);
        itemIdBytes.CopyTo(buf, 21 + pathBytes.Length);
        await sock.SendAsync(buf, SocketFlags.None, ct);
    }

    private static async Task<byte[]?> ReceiveResponseAsync(Socket sock, uint expectedId, CancellationToken ct)
    {
        var header = new byte[8];
        if (!await ReceiveBytesAsync(sock, header, ct)) return null;

        var responseId = BinaryPrimitives.ReadUInt32LittleEndian(header);
        if (responseId != expectedId)
            throw new InvalidOperationException(
                $"[SeekPreview] socket desync: expected request_id={expectedId}, got={responseId} — socket reset");

        var jpegLen = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4));
        if (jpegLen == 0) return null;

        var jpeg = new byte[jpegLen];
        if (!await ReceiveBytesAsync(sock, jpeg, ct)) return null;
        return jpeg;
    }

    private static async Task<bool> ReceiveBytesAsync(Socket sock, byte[] buf, CancellationToken ct)
    {
        var offset = 0;
        while (offset < buf.Length)
        {
            var read = await sock.ReceiveAsync(buf.AsMemory(offset), SocketFlags.None, ct);
            if (read == 0) return false;
            offset += read;
        }
        return true;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try { _fetchSocket?.Dispose(); } catch { }
        try { _prefetchSocket?.Dispose(); } catch { }
        _startLock.Dispose();
        _fetchLock.Dispose();
        _prefetchConnLock.Dispose();

        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill();
                _process.Dispose();
            }
        }
        catch { }
    }
}
