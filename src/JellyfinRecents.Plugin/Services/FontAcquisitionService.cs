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

    // System font paths are probed before downloading.
    // Jellyfin's official Docker image (Debian bookworm) installs Noto CJK via fonts-noto-cjk
    // to /usr/share/fonts/opentype/noto/. OTF is preferred over TTC because ab_glyph only
    // reads index 0 from a TTC collection, which may not be the intended variant.
    private static readonly string[] NotoSansSystemPaths =
    [
        "/usr/share/fonts/opentype/noto/NotoSansCJKjp-Regular.otf",
        "/usr/share/fonts/noto-cjk/NotoSansCJKjp-Regular.otf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    ];

    private static readonly string[] NotoSerifSystemPaths =
    [
        "/usr/share/fonts/opentype/noto/NotoSerifCJKjp-Regular.otf",
        "/usr/share/fonts/noto-cjk/NotoSerifCJKjp-Regular.otf",
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc",
    ];

    private static readonly string[] NotoEmojiSystemPaths =
    [
        "/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf",
        "/usr/share/fonts/noto/NotoEmoji-Regular.ttf",
        "/usr/share/fonts/truetype/noto-emoji/NotoEmoji-Regular.ttf",
    ];

    // Roboto is available via fonts-roboto-hinted / fonts-roboto-unhinted on Debian/Ubuntu.
    private static readonly string[] RobotoSystemPaths =
    [
        "/usr/share/fonts/truetype/roboto/hinted/Roboto-Regular.ttf",
        "/usr/share/fonts/truetype/roboto/unhinted/Roboto-Regular.ttf",
        "/usr/share/fonts/truetype/roboto/Roboto-Regular.ttf",
        "/usr/share/fonts/roboto/Roboto-Regular.ttf",
    ];

    private static readonly string[] RobotoMonoSystemPaths =
    [
        "/usr/share/fonts/truetype/roboto/hinted/RobotoMono-Regular.ttf",
        "/usr/share/fonts/truetype/roboto/RobotoMono-Regular.ttf",
        "/usr/share/fonts/roboto/RobotoMono-Regular.ttf",
    ];

    // Oswald, Playfair Display, and Cinzel are not in standard Linux package repos,
    // but probe anyway in case the user has manually installed them.
    private static readonly string[] OswaldSystemPaths =
    [
        "/usr/share/fonts/truetype/oswald/Oswald-Regular.ttf",
        "/usr/share/fonts/oswald/Oswald-Regular.ttf",
    ];

    private static readonly string[] PlayfairSystemPaths =
    [
        "/usr/share/fonts/truetype/playfair/PlayfairDisplay-Regular.ttf",
        "/usr/share/fonts/playfair-display/PlayfairDisplay-Regular.ttf",
    ];

    private static readonly string[] CinzelSystemPaths =
    [
        "/usr/share/fonts/truetype/cinzel/Cinzel-Regular.ttf",
        "/usr/share/fonts/cinzel/Cinzel-Regular.ttf",
    ];

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
        new("https://cdn.jsdelivr.net/gh/googlefonts/RobotoMono@main/fonts/ttf/RobotoMono-Regular.ttf"),
        new("https://github.com/googlefonts/RobotoMono/raw/main/fonts/ttf/RobotoMono-Regular.ttf"),
    ];

    private static readonly FontSource[] RobotoSources =
    [
        // v2.138 tag — main branch was restructured to variable fonts
        new("https://cdn.jsdelivr.net/gh/googlefonts/roboto@v2.138/src/hinted/Roboto-Regular.ttf"),
        new("https://www.1001fonts.com/download/font/roboto.regular.ttf"),
    ];

    private static readonly FontSource[] OswaldSources =
    [
        new("https://cdn.jsdelivr.net/gh/googlefonts/OswaldFont@main/fonts/ttf/Oswald-Regular.ttf"),
        new("https://github.com/googlefonts/OswaldFont/raw/main/fonts/ttf/Oswald-Regular.ttf"),
    ];

    private static readonly FontSource[] PlayfairSources =
    [
        // googlefonts/Playfair main branch was restructured; use 1001fonts as primary
        new("https://www.1001fonts.com/download/font/playfair-display.regular.ttf"),
        new("https://www.fontsquirrel.com/fonts/download/playfair-display",
            "PlayfairDisplay-Regular.ttf"),
    ];

    private static readonly FontSource[] CinzelSources =
    [
        // googlefonts/cinzel main branch was restructured; use 1001fonts as primary
        new("https://www.1001fonts.com/download/font/cinzel.regular.ttf"),
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
            fontsDir, "NotoSansJP.otf", "custom-font-sans.otf", NotoSansSources, ct, NotoSansSystemPaths);
        NotoSerifPath = await AcquireFontAsync(
            fontsDir, "NotoSerifJP.otf", "custom-font-serif.otf", NotoSerifSources, ct, NotoSerifSystemPaths);
        RobotoMonoPath = await AcquireFontAsync(
            fontsDir, "RobotoMono-Regular.ttf", "custom-font-mono.ttf", RobotoMonoSources, ct, RobotoMonoSystemPaths);
        RobotoPath = await AcquireFontAsync(
            fontsDir, "Roboto-Regular.ttf", "custom-font-roboto.ttf", RobotoSources, ct, RobotoSystemPaths);
        OswaldPath = await AcquireFontAsync(
            fontsDir, "Oswald-Regular.ttf", "custom-font-oswald.ttf", OswaldSources, ct, OswaldSystemPaths);
        PlayfairPath = await AcquireFontAsync(
            fontsDir, "PlayfairDisplay-Regular.ttf", "custom-font-playfair.ttf", PlayfairSources, ct, PlayfairSystemPaths);
        CinzelPath = await AcquireFontAsync(
            fontsDir, "Cinzel-Regular.ttf", "custom-font-cinzel.ttf", CinzelSources, ct, CinzelSystemPaths);
        NotoEmojiPath = await AcquireFontAsync(
            fontsDir, "NotoEmoji-Regular.ttf", "custom-font-emoji.ttf", NotoEmojiSources, ct, NotoEmojiSystemPaths);
    }

    private async Task<string?> AcquireFontAsync(
        string fontsDir, string cacheFileName, string customFileName,
        IReadOnlyList<FontSource> sources, CancellationToken ct,
        IReadOnlyList<string>? systemPaths = null)
    {
        // 1. User-placed custom file takes top priority — no download needed
        var customPath = Path.Combine(fontsDir, customFileName);
        if (File.Exists(customPath)) return customPath;

        // 2. Bundled font — ships inside the "Jellyfin Recents + Fonts" release zip alongside the DLL.
        //    The zip extracts fonts/ next to JellyfinRecents.Plugin.dll, so probing the assembly
        //    directory requires no data-path write and works immediately after install.
        var assemblyDir = Path.GetDirectoryName(typeof(FontAcquisitionService).Assembly.Location);
        if (assemblyDir is not null)
        {
            var bundledPath = Path.Combine(assemblyDir, "fonts", cacheFileName);
            if (File.Exists(bundledPath))
            {
                _logger.LogInformation("Using bundled font: {Path}", bundledPath);
                return bundledPath;
            }
        }

        // 3. System font probe — use OS-installed font if available (no download needed).
        //    OTF is listed before TTC so ab_glyph gets a single-font file; TTC index 0
        //    may not be the intended variant when multiple languages are packed together.
        if (systemPaths is not null)
        {
            foreach (var sysPath in systemPaths)
            {
                if (File.Exists(sysPath))
                {
                    _logger.LogInformation("Using system font: {Path}", sysPath);
                    return sysPath;
                }
            }
        }

        // 4. Already cached and checksum valid
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

        // 5. Try each source in order; return on first success
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
