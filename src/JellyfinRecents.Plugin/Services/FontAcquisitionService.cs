using System.Net.Http;
using System.Security.Cryptography;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Services;

public class FontAcquisitionService : IHostedService
{
    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<FontAcquisitionService> _logger;

    // GitHub raw URLs for Noto CJK fonts (OTF, Japanese subset)
    private const string NotoSansUrl =
        "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf";
    private const string NotoSerifUrl =
        "https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Regular.otf";

    public string? NotoSansPath { get; private set; }
    public string? NotoSerifPath { get; private set; }

    public FontAcquisitionService(
        IApplicationPaths appPaths,
        ILogger<FontAcquisitionService> logger)
    {
        _appPaths = appPaths;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Non-blocking: run font acquisition in background
        _ = Task.Run(() => AcquireFontsAsync(cancellationToken), cancellationToken);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task AcquireFontsAsync(CancellationToken ct)
    {
        var fontsDir = Path.Combine(_appPaths.DataPath, "fonts");
        Directory.CreateDirectory(fontsDir);

        NotoSansPath = await AcquireFontAsync(
            fontsDir, "NotoSansJP.otf", "custom-font-sans.otf", NotoSansUrl, ct);
        NotoSerifPath = await AcquireFontAsync(
            fontsDir, "NotoSerifJP.otf", "custom-font-serif.otf", NotoSerifUrl, ct);
    }

    private async Task<string?> AcquireFontAsync(
        string fontsDir, string cacheFileName, string customFileName,
        string downloadUrl, CancellationToken ct)
    {
        // 1. Custom override takes priority
        var customPath = Path.Combine(fontsDir, customFileName);
        if (File.Exists(customPath)) return customPath;

        // 2. Already downloaded — verify checksum
        var cachedPath = Path.Combine(fontsDir, cacheFileName);
        var checksumPath = cachedPath + ".sha256";
        if (File.Exists(cachedPath) && File.Exists(checksumPath))
        {
            try
            {
                var expectedHash = await File.ReadAllTextAsync(checksumPath, ct);
                var actualHash = await ComputeFileHashAsync(cachedPath, ct);
                if (string.Equals(expectedHash.Trim(), actualHash, StringComparison.OrdinalIgnoreCase))
                    return cachedPath;
            }
            catch { /* fall through to re-download */ }
        }

        // 3. Download
        try
        {
            _logger.LogInformation("Downloading font from {Url}", downloadUrl);
            using var http = new HttpClient();
            http.Timeout = TimeSpan.FromMinutes(5);
            var data = await http.GetByteArrayAsync(downloadUrl, ct);
            await File.WriteAllBytesAsync(cachedPath, data, ct);
            var hash = ComputeHash(data);
            await File.WriteAllTextAsync(checksumPath, hash, ct);
            _logger.LogInformation("Font saved to {Path}", cachedPath);
            return cachedPath;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                "Failed to download font from {Url}: {Message}. " +
                "To install manually, place the font file at {Path}",
                downloadUrl, ex.Message, cachedPath);
            return null;
        }
    }

    private static async Task<string> ComputeFileHashAsync(string path, CancellationToken ct)
    {
        await using var fs = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(fs, ct);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string ComputeHash(byte[] data)
    {
        var hash = SHA256.HashData(data);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
