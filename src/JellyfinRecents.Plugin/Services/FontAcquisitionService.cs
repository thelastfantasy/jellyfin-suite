using System.IO.Compression;
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

    /// <summary>
    /// Represents a download source: either a direct font file URL,
    /// or a ZIP archive URL with the entry path to extract.
    /// </summary>
    private record FontSource(string Url, string? ZipEntry = null);

    // Primary: GitHub raw content (global).
    // Fallback: Alibaba Cloud mirror (mirrors.aliyun.com) — reliable inside China.
    //           The mirror hosts GitHub Release ZIPs; we extract the Regular weight OTF.
    // Users may also place a custom file at the "custom-font-*.otf" path to bypass all downloads.
    private static readonly FontSource[] NotoSansSources =
    [
        new("https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf"),
        new("https://mirrors.aliyun.com/github/releases/googlefonts/noto-cjk/Sans2.004/16_NotoSansJP.zip",
            "NotoSansJP-Regular.otf"),
    ];

    private static readonly FontSource[] NotoSerifSources =
    [
        new("https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Regular.otf"),
        new("https://mirrors.aliyun.com/github/releases/googlefonts/noto-cjk/Serif2.003/12_NotoSerifJP.zip",
            "NotoSerifJP-Regular.otf"),
    ];

    private static readonly FontSource[] RobotoMonoSources =
    [
        new("https://github.com/googlefonts/RobotoMono/raw/main/fonts/ttf/RobotoMono-Regular.ttf"),
        new("https://cdn.jsdelivr.net/gh/googlefonts/RobotoMono@main/fonts/ttf/RobotoMono-Regular.ttf"),
    ];

    private static readonly FontSource[] RobotoSources =
    [
        new("https://github.com/googlefonts/roboto/raw/main/fonts/ttf/Roboto-Regular.ttf"),
        new("https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/fonts/ttf/Roboto-Regular.ttf"),
    ];

    private static readonly FontSource[] OswaldSources =
    [
        new("https://github.com/googlefonts/OswaldFont/raw/main/fonts/ttf/Oswald-Regular.ttf"),
        new("https://cdn.jsdelivr.net/gh/googlefonts/OswaldFont@main/fonts/ttf/Oswald-Regular.ttf"),
    ];

    private static readonly FontSource[] PlayfairSources =
    [
        new("https://github.com/googlefonts/Playfair/raw/main/fonts/ttf/PlayfairDisplay-Regular.ttf"),
        new("https://cdn.jsdelivr.net/gh/googlefonts/Playfair@main/fonts/ttf/PlayfairDisplay-Regular.ttf"),
    ];

    private static readonly FontSource[] CinzelSources =
    [
        new("https://github.com/googlefonts/cinzel/raw/main/fonts/ttf/Cinzel-Regular.ttf"),
        new("https://cdn.jsdelivr.net/gh/googlefonts/cinzel@main/fonts/ttf/Cinzel-Regular.ttf"),
    ];

    // Monochrome (outline) Noto Emoji — ab_glyph compatible, used as per-char emoji fallback
    private static readonly FontSource[] NotoEmojiSources =
    [
        new("https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoEmoji-Regular.ttf"),
        new("https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/fonts/NotoEmoji-Regular.ttf"),
    ];

    public string? NotoSansPath { get; private set; }
    public string? NotoSerifPath { get; private set; }
    public string? RobotoMonoPath { get; private set; }
    public string? RobotoPath { get; private set; }
    public string? OswaldPath { get; private set; }
    public string? PlayfairPath { get; private set; }
    public string? CinzelPath { get; private set; }
    public string? NotoEmojiPath { get; private set; }

    public FontAcquisitionService(
        IApplicationPaths appPaths,
        ILogger<FontAcquisitionService> logger)
    {
        _appPaths = appPaths;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _ = Task.Run(() => AcquireFontsAsync(cancellationToken), cancellationToken);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task AcquireFontsAsync(CancellationToken ct)
    {
        var fontsDir = Path.Combine(_appPaths.DataPath, "fonts");
        Directory.CreateDirectory(fontsDir);

        NotoSansPath = await AcquireFontAsync(
            fontsDir, "NotoSansJP.otf", "custom-font-sans.otf", NotoSansSources, ct);
        NotoSerifPath = await AcquireFontAsync(
            fontsDir, "NotoSerifJP.otf", "custom-font-serif.otf", NotoSerifSources, ct);
        RobotoMonoPath = await AcquireFontAsync(
            fontsDir, "RobotoMono-Regular.ttf", "custom-font-mono.ttf", RobotoMonoSources, ct);
        RobotoPath = await AcquireFontAsync(
            fontsDir, "Roboto-Regular.ttf", "custom-font-roboto.ttf", RobotoSources, ct);
        OswaldPath = await AcquireFontAsync(
            fontsDir, "Oswald-Regular.ttf", "custom-font-oswald.ttf", OswaldSources, ct);
        PlayfairPath = await AcquireFontAsync(
            fontsDir, "PlayfairDisplay-Regular.ttf", "custom-font-playfair.ttf", PlayfairSources, ct);
        CinzelPath = await AcquireFontAsync(
            fontsDir, "Cinzel-Regular.ttf", "custom-font-cinzel.ttf", CinzelSources, ct);
        NotoEmojiPath = await AcquireFontAsync(
            fontsDir, "NotoEmoji-Regular.ttf", "custom-font-emoji.ttf", NotoEmojiSources, ct);
    }

    private async Task<string?> AcquireFontAsync(
        string fontsDir, string cacheFileName, string customFileName,
        IReadOnlyList<FontSource> sources, CancellationToken ct)
    {
        // 1. User-placed custom file takes priority — no download needed
        var customPath = Path.Combine(fontsDir, customFileName);
        if (File.Exists(customPath)) return customPath;

        // 2. Already cached and checksum valid
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
            catch { /* checksum mismatch — fall through to re-download */ }
        }

        // 3. Try each source in order; return on first success
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        foreach (var source in sources)
        {
            try
            {
                _logger.LogInformation("Downloading font from {Url}", source.Url);
                var raw = await http.GetByteArrayAsync(source.Url, ct);

                var fontBytes = source.ZipEntry is not null
                    ? ExtractFromZip(raw, source.ZipEntry)
                    : raw;

                await File.WriteAllBytesAsync(cachedPath, fontBytes, ct);
                var hash = ComputeHash(fontBytes);
                await File.WriteAllTextAsync(checksumPath, hash, ct);
                _logger.LogInformation("Font saved to {Path}", cachedPath);
                return cachedPath;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Font download failed from {Url}: {Message}", source.Url, ex.Message);
            }
        }

        _logger.LogError(
            "All font sources failed for {File}. " +
            "To install manually, place the font file at {Path}",
            cacheFileName, customPath);
        return null;
    }

    private static byte[] ExtractFromZip(byte[] zipBytes, string entryName)
    {
        using var ms = new MemoryStream(zipBytes);
        using var zip = new ZipArchive(ms, ZipArchiveMode.Read);

        // Match by filename only — ignore subdirectory prefix if present
        var entry = zip.Entries.FirstOrDefault(e =>
            string.Equals(Path.GetFileName(e.FullName), entryName, StringComparison.OrdinalIgnoreCase))
            ?? throw new FileNotFoundException($"Entry '{entryName}' not found in ZIP.");

        using var stream = entry.Open();
        using var result = new MemoryStream();
        stream.CopyTo(result);
        return result.ToArray();
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
