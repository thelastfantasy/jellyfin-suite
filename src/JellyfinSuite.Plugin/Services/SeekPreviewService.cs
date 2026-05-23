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

    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<SeekPreviewService> _logger;

    private readonly string _socketPath;
    private readonly string _binaryPath;

    private Process? _process;

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
        _appPaths = appPaths;
        _logger = logger;
        _socketPath = Path.Combine(appPaths.DataPath, "jfs-seek-preview.sock");
        _binaryPath = Path.Combine(appPaths.PluginsPath, "JellyfinSuite", BinaryName);
    }

    public bool IsAvailable => RuntimeInformation.IsOSPlatform(OSPlatform.Linux)
                               && File.Exists(_binaryPath);

    public async Task EnsureStartedAsync(CancellationToken ct = default)
    {
        if (!IsAvailable) return;
        if (_process is { HasExited: false }) return;

        try
        {
            // Kill stale socket file
            if (File.Exists(_socketPath))
                File.Delete(_socketPath);

            var psi = new System.Diagnostics.ProcessStartInfo(_binaryPath, _socketPath)
            {
                UseShellExecute = false,
                RedirectStandardError = true,
            };

            // jellyfin-ffmpeg installs its .so files under /usr/lib/jellyfin-ffmpeg/lib/,
            // which is not on the default ldconfig path.
            psi.Environment["LD_LIBRARY_PATH"] = "/usr/lib/jellyfin-ffmpeg/lib";

            _process = System.Diagnostics.Process.Start(psi);
            if (_process == null)
            {
                _logger.LogWarning("[SeekPreview] Failed to start seek-preview daemon");
                return;
            }

            // Pipe stderr to Jellyfin log
            _ = Task.Run(async () =>
            {
                string? line;
                while ((line = await _process.StandardError.ReadLineAsync()) != null)
                    _logger.LogDebug("[seek-preview] {Line}", line);
            }, ct);

            // Wait for socket file to appear (max 5 s)
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

            // Auto-restart on exit
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
    }

    private async Task<Socket> ConnectUnixSocketAsync(CancellationToken ct)
    {
        var sock = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        var ep = new UnixDomainSocketEndPoint(_socketPath);
        await sock.ConnectAsync(ep, ct);
        return sock;
    }

    /// <summary>
    /// Fetches a JPEG frame for the given file at pos_ms. Returns null on failure.
    /// </summary>
    public async Task<byte[]?> FetchAsync(
        string filePath, long posMs, int width, CancellationToken ct = default)
    {
        if (_fetchSocket == null) return null;

        await _fetchLock.WaitAsync(ct);
        try
        {
            var id = Interlocked.Increment(ref _nextRequestId);
            await SendRequestAsync(_fetchSocket, 0x01, id, posMs, width, filePath, ct);
            return await ReceiveResponseAsync(_fetchSocket, ct);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "[SeekPreview] FetchAsync error");
            return null;
        }
        finally
        {
            _fetchLock.Release();
        }
    }

    /// <summary>
    /// Sends a prefetch hint. Fire-and-forget — never blocks the caller.
    /// </summary>
    public void Prefetch(string filePath, long posMs, int width)
    {
        if (_prefetchSocket == null) return;

        _ = Task.Run(async () =>
        {
            await _prefetchConnLock.WaitAsync();
            try
            {
                var id = Interlocked.Increment(ref _nextRequestId);
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await SendRequestAsync(_prefetchSocket, 0x02, id, posMs, width, filePath, cts.Token);
                // Read and discard the ACK (jpeg_len = 0)
                var buf = new byte[8];
                _ = await ReceiveBytesAsync(_prefetchSocket, buf, cts.Token);
            }
            catch
            {
                // Prefetch is best-effort — swallow all errors
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
        string filePath, CancellationToken ct)
    {
        var pathBytes = System.Text.Encoding.UTF8.GetBytes(filePath);
        // 1 + 4 + 8 + 4 + 4 + N
        var buf = new byte[21 + pathBytes.Length];
        buf[0] = priority;
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(1), requestId);
        BinaryPrimitives.WriteInt64LittleEndian(buf.AsSpan(5), posMs);
        BinaryPrimitives.WriteInt32LittleEndian(buf.AsSpan(13), width);
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(17), (uint)pathBytes.Length);
        pathBytes.CopyTo(buf, 21);
        await sock.SendAsync(buf, SocketFlags.None, ct);
    }

    private static async Task<byte[]?> ReceiveResponseAsync(Socket sock, CancellationToken ct)
    {
        var header = new byte[8];
        if (!await ReceiveBytesAsync(sock, header, ct)) return null;

        // var _requestId = BinaryPrimitives.ReadUInt32LittleEndian(header);
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
