using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.JellyfinRecents.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Services;

public class PosterSheetJobService : IDisposable
{
    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<PosterSheetJobService> _logger;
    private readonly FontAcquisitionService _fontService;
    private readonly ConcurrentDictionary<string, PosterSheetJob> _jobs = new();
    private readonly ConcurrentDictionary<string, string> _activeJobIdByItemId = new();
    private bool _disposed;

    private static string TempDir => Path.GetTempPath();
    private const string TempPrefix = "postersheet-";

    public PosterSheetJobService(
        IApplicationPaths appPaths,
        ILogger<PosterSheetJobService> logger,
        FontAcquisitionService fontService)
    {
        _appPaths = appPaths;
        _logger = logger;
        _fontService = fontService;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var job in _jobs.Values)
            try { job.Cts.Cancel(); } catch { }
    }

    // Returns existing active job ID or creates a new job
    public PosterSheetJob GetOrCreateJob(string itemId, string itemTitle, PosterSheetRequestDto req, string inputPath)
    {
        // Check for existing active job by itemId via the active-job tracking map
        if (_activeJobIdByItemId.TryGetValue(itemId, out var activeJobId) &&
            _jobs.TryGetValue(activeJobId, out var existing) &&
            existing.Status is JobStatus.Queued or JobStatus.Running)
            return existing;

        var seed = req.Mode == "random"
            ? (req.Seed ?? Guid.NewGuid().ToString("N"))
            : ComputeDeterministicSeed(itemId);

        var overlayHash = ComputeOverlayHash(req.Overlay);
        var skipHash = req.SkipSegments is { Count: > 0 }
            ? ComputeSkipHash(req.SkipSegments)
            : "0";
        var outputPath = Path.Combine(TempDir,
            $"{TempPrefix}{itemId}_{req.Rows}x{req.Cols}_{seed}_{overlayHash}_{skipHash}.webp");

        var job = new PosterSheetJob
        {
            ItemId = itemId,
            ItemTitle = itemTitle,
            Rows = req.Rows,
            Cols = req.Cols,
            Mode = req.Mode == "random" ? JobMode.Random : JobMode.Deterministic,
            Seed = seed,
            Overlay = req.Overlay,
            Total = req.Rows * req.Cols,
            OutputPath = outputPath,
            SkipSegments = req.SkipSegments,
        };

        _jobs[job.Id] = job;
        _activeJobIdByItemId[itemId] = job.Id;
        _ = Task.Run(() => RunJobAsync(job, inputPath));
        return job;
    }

    public PosterSheetJob? GetJob(string jobId)
        => _jobs.TryGetValue(jobId, out var job) ? job : null;

    public IEnumerable<PosterSheetJob> GetAllJobs()
        => _jobs.Values;

    public string? GetActiveJobIdForItem(string itemId)
        => _activeJobIdByItemId.TryGetValue(itemId, out var id) ? id : null;

    public void CancelJob(string jobId)
    {
        var job = GetJob(jobId);
        if (job is null) return;
        job.Cts.Cancel();
        job.Status = JobStatus.Cancelled;
    }

    /// <summary>
    /// Cancel (if running), delete the output file, and remove the job from memory.
    /// </summary>
    public void DeleteJob(string jobId)
    {
        var job = GetJob(jobId);
        if (job is null) return;

        if (job.Status is JobStatus.Queued or JobStatus.Running)
        {
            job.Cts.Cancel();
            job.Status = JobStatus.Cancelled;
        }

        if (!string.IsNullOrEmpty(job.OutputPath) && File.Exists(job.OutputPath))
        {
            try { File.Delete(job.OutputPath); } catch { /* best-effort */ }
        }

        _jobs.TryRemove(jobId, out _);
        _activeJobIdByItemId.TryRemove(job.ItemId, out _);
    }

    /// <summary>
    /// Remove completed jobs whose output file no longer exists on disk.
    /// Called by CleanPosterSheetsTask after deleting expired files.
    /// </summary>
    public void RemoveExpiredJobs()
    {
        foreach (var job in _jobs.Values.ToList())
        {
            if (job.Status != JobStatus.Done) continue;
            if (!string.IsNullOrEmpty(job.OutputPath) && File.Exists(job.OutputPath)) continue;
            _jobs.TryRemove(job.Id, out _);
            _activeJobIdByItemId.TryRemove(job.ItemId, out _);
        }
    }

    public bool TryGetCachedPath(string itemId, int rows, int cols, string seed, string overlayHash,
        out string? path)
    {
        var filePath = Path.Combine(TempDir, $"{TempPrefix}{itemId}_{rows}x{cols}_{seed}_{overlayHash}.webp");
        if (File.Exists(filePath)) { path = filePath; return true; }
        path = null;
        return false;
    }

    private async Task RunJobAsync(PosterSheetJob job, string inputPath)
    {
        job.Status = JobStatus.Running;
        try
        {
            // Cache hit — skip generation
            if (File.Exists(job.OutputPath!))
            {
                job.Progress = job.Total;
                job.Status = JobStatus.Done;
                return;
            }

            var binaryPath = GetBinaryPath();
            if (!File.Exists(binaryPath))
            {
                job.Error = $"poster-gen binary not found at {binaryPath}";
                job.Status = JobStatus.Error;
                return;
            }

            EnsureExecutable(binaryPath);

            var args = BuildArgsWithInput(job, inputPath);
            var psi = new System.Diagnostics.ProcessStartInfo(binaryPath, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var process = System.Diagnostics.Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to start poster-gen");

            // Register cancellation → kill process
            job.Cts.Token.Register(() =>
            {
                try { process.Kill(); } catch { }
            });

            // Drain stderr in background so buffer never blocks; log at Debug level
            _ = Task.Run(async () =>
            {
                string? errLine;
                while ((errLine = await process.StandardError.ReadLineAsync()) != null)
                    _logger.LogDebug("[poster-gen] {Line}", errLine);
            });

            string? line;
            while ((line = await process.StandardOutput.ReadLineAsync()) != null)
            {
                if (job.Cts.Token.IsCancellationRequested) break;

                if (line.StartsWith("PROGRESS ", StringComparison.Ordinal))
                {
                    var parts = line[9..].Split('/');
                    if (parts.Length == 2 && int.TryParse(parts[0], out var n))
                        job.Progress = n;
                }
                else if (line.StartsWith("MEDIA_INFO ", StringComparison.Ordinal))
                {
                    try
                    {
                        job.MediaInfo = JsonSerializer.Deserialize<MediaInfoDto>(
                            line[11..],
                            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower });
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning("Failed to parse MEDIA_INFO: {Message}", ex.Message);
                    }
                }
                else if (line.StartsWith("DONE ", StringComparison.Ordinal) || line == "DONE")
                {
                    job.Progress = job.Total;
                    job.Status = JobStatus.Done;
                }
                else if (line.StartsWith("ERROR ", StringComparison.Ordinal))
                {
                    job.Error = line[6..];
                    job.Status = JobStatus.Error;
                }
            }

            await process.WaitForExitAsync(job.Cts.Token);
            if (job.Status == JobStatus.Running)
                job.Status = process.ExitCode == 0 ? JobStatus.Done : JobStatus.Error;
        }
        catch (OperationCanceledException)
        {
            job.Status = JobStatus.Cancelled;
        }
        catch (Exception ex)
        {
            job.Error = ex.Message;
            job.Status = JobStatus.Error;
            _logger.LogError(ex, "Job {JobId} failed", job.Id);
        }
    }

    private string? ResolveFontPath(string fontKey) => fontKey switch
    {
        "noto-sans" or "noto-sans-jp" => _fontService.NotoSansPath,
        "noto-serif" or "noto-serif-jp" => _fontService.NotoSerifPath,
        "roboto" => _fontService.RobotoPath ?? _fontService.NotoSansPath,
        "oswald" => _fontService.OswaldPath ?? _fontService.NotoSansPath,
        "playfair" => _fontService.PlayfairPath ?? _fontService.NotoSerifPath,
        "cinzel" => _fontService.CinzelPath ?? _fontService.NotoSerifPath,
        _ => _fontService.NotoSansPath,
    };

    // Build CLI args for poster-gen (default subcommand = generate)
    private string BuildArgs(PosterSheetJob job)
    {
        var fontPath = ResolveFontPath(job.Overlay.FontFamily);

        bool hasCjk = job.Overlay.BrandingText.Any(c => c >= '一' && c <= '鿿');
        var brandingFontKey = hasCjk ? job.Overlay.BrandingCjkFont : job.Overlay.BrandingLatinFont;
        var brandingFontPath = ResolveFontPath(brandingFontKey);

        var sb = new StringBuilder();
        sb.Append($"--ffmpeg-path \"{GetFfmpegPath()}\"");
        sb.Append($" --output \"{job.OutputPath}\"");
        sb.Append($" --rows {job.Rows} --cols {job.Cols}");
        sb.Append($" --seed {job.Seed}");
        if (job.Mode == JobMode.Random) sb.Append(" --mode random");
        sb.Append($" --thumb-width 320");
        sb.Append($" --color-theme {job.Overlay.ColorTheme}");
        if (fontPath != null) sb.Append($" --font-path \"{fontPath}\"");
        if (brandingFontPath != null && brandingFontPath != fontPath)
            sb.Append($" --branding-font-path \"{brandingFontPath}\"");
        if (_fontService.RobotoMonoPath != null)
            sb.Append($" --timestamp-font-path \"{_fontService.RobotoMonoPath}\"");
        if (_fontService.NotoEmojiPath != null)
            sb.Append($" --emoji-font-path \"{_fontService.NotoEmojiPath}\"");
        if (job.Overlay.ShowFrameTimestamp) sb.Append(" --show-timestamp");
        if (!string.IsNullOrEmpty(job.Overlay.TimestampPosition))
            sb.Append($" --timestamp-position {job.Overlay.TimestampPosition}");
        if (!job.Overlay.BrandingEnabled) sb.Append(" --no-branding");
        else sb.Append($" --branding-text \"{job.Overlay.BrandingText}\"");
        if (!job.Overlay.VideoInfoEnabled) sb.Append(" --no-video-info");
        if (!job.Overlay.ShowFileSize) sb.Append(" --no-file-size");
        if (!job.Overlay.ShowResolutionFps) sb.Append(" --no-resolution-fps");
        if (!job.Overlay.ShowVideoEncoding) sb.Append(" --no-video-encoding");
        if (!job.Overlay.ShowAudioEncoding) sb.Append(" --no-audio-encoding");
        if (!job.Overlay.ShowDuration) sb.Append(" --no-duration");
        sb.Append($" --lang {job.Overlay.Lang}");
        if (job.SkipSegments is { Count: > 0 })
            foreach (var seg in job.SkipSegments)
                sb.Append($" --skip-segment {seg.StartMs}:{seg.EndMs}");
        return sb.ToString();
    }

    public string BuildArgsWithInput(PosterSheetJob job, string inputPath)
        => $"--input \"{inputPath}\" " + BuildArgs(job);

    public string BuildPreviewArgs(PreviewRequestDto req, string outputPath)
    {
        var fontPath = ResolveFontPath(req.Overlay.FontFamily);

        bool hasCjk = req.Overlay.BrandingText.Any(c => c >= '一' && c <= '鿿');
        var brandingFontKey = hasCjk ? req.Overlay.BrandingCjkFont : req.Overlay.BrandingLatinFont;
        var brandingFontPath = ResolveFontPath(brandingFontKey);

        var sb = new StringBuilder();
        sb.Append("preview");
        sb.Append($" --output \"{outputPath}\"");
        sb.Append($" --color-theme {req.Overlay.ColorTheme}");
        if (fontPath != null) sb.Append($" --font-path \"{fontPath}\"");
        if (brandingFontPath != null && brandingFontPath != fontPath)
            sb.Append($" --branding-font-path \"{brandingFontPath}\"");
        if (_fontService.RobotoMonoPath != null)
            sb.Append($" --timestamp-font-path \"{_fontService.RobotoMonoPath}\"");
        if (_fontService.NotoEmojiPath != null)
            sb.Append($" --emoji-font-path \"{_fontService.NotoEmojiPath}\"");
        if (req.Overlay.ShowFrameTimestamp) sb.Append(" --show-timestamp");
        if (!string.IsNullOrEmpty(req.Overlay.TimestampPosition))
            sb.Append($" --timestamp-position {req.Overlay.TimestampPosition}");
        if (!req.Overlay.BrandingEnabled) sb.Append(" --no-branding");
        else sb.Append($" --branding-text \"{req.Overlay.BrandingText}\"");
        if (!req.Overlay.VideoInfoEnabled) sb.Append(" --no-video-info");
        if (!req.Overlay.ShowFileSize) sb.Append(" --no-file-size");
        if (!req.Overlay.ShowResolutionFps) sb.Append(" --no-resolution-fps");
        if (!req.Overlay.ShowVideoEncoding) sb.Append(" --no-video-encoding");
        if (!req.Overlay.ShowAudioEncoding) sb.Append(" --no-audio-encoding");
        if (!req.Overlay.ShowDuration) sb.Append(" --no-duration");
        sb.Append($" --rows {req.Rows} --cols {req.Cols}");
        sb.Append($" --lang {req.Overlay.Lang}");
        return sb.ToString();
    }

    public static string GetBinaryPath()
    {
        var dir = Path.GetDirectoryName(typeof(PosterSheetJobService).Assembly.Location)!;
        var name = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? "poster-gen-win-x64.exe"
            : "poster-gen-linux-x64";
        return Path.Combine(dir, name);
    }

    private static void EnsureExecutable(string path)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            File.SetUnixFileMode(path,
                UnixFileMode.UserRead | UnixFileMode.UserExecute |
                UnixFileMode.GroupRead | UnixFileMode.GroupExecute);
    }

    private static string GetFfmpegPath()
    {
        var candidates = new[]
        {
            "/usr/lib/jellyfin-ffmpeg/ffmpeg",
            "/usr/bin/ffmpeg",
            "ffmpeg",
        };
        return candidates.FirstOrDefault(File.Exists) ?? "ffmpeg";
    }

    private static string ComputeDeterministicSeed(string itemId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(itemId));
        return Convert.ToHexString(hash)[..16].ToLowerInvariant();
    }

    public static string ComputeOverlayHash(OverlaySettings overlay)
    {
        var json = JsonSerializer.Serialize(overlay,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return Convert.ToHexString(hash)[..8].ToLowerInvariant();
    }

    private static string ComputeSkipHash(List<SkipSegmentDto> segs)
    {
        var str = string.Join(",", segs.OrderBy(s => s.StartMs).Select(s => $"{s.StartMs}:{s.EndMs}"));
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(str));
        return Convert.ToHexString(hash)[..8].ToLowerInvariant();
    }
}
