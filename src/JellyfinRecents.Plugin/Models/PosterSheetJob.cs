namespace Jellyfin.Plugin.JellyfinRecents.Models;

public enum JobStatus { Queued, Running, Done, Error, Cancelled }
public enum JobMode { Deterministic, Random }
public enum ColorTheme { Classic, Dark, Light, Cinematic, Minimal }
public enum FontFamily { NotoSans, NotoSerif }

public class OverlaySettings
{
    public bool BrandingEnabled { get; set; } = true;
    public string BrandingText { get; set; } = "Jellyfin Recents";
    public bool VideoInfoEnabled { get; set; } = true;
    public bool ShowFileSize { get; set; } = true;
    public bool ShowResolutionFps { get; set; } = true;
    public bool ShowVideoEncoding { get; set; } = true;
    public bool ShowAudioEncoding { get; set; } = true;
    public bool ShowDuration { get; set; } = true;
    public bool ShowFrameTimestamp { get; set; } = false;
    public string ColorTheme { get; set; } = "classic";
    public string FontFamily { get; set; } = "noto-sans";
    public string Lang { get; set; } = "en";
}

public class MediaInfoDto
{
    public string Filename { get; set; } = string.Empty;
    public string FileSize { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public string Resolution { get; set; } = string.Empty;
    public double Fps { get; set; }
    public string VideoCodec { get; set; } = string.Empty;
    public int? BitDepth { get; set; }
    public string? HdrType { get; set; }
    public string? ColourSpace { get; set; }
    public string? AudioCodec { get; set; }
    public string? AudioFormat { get; set; }
    public string? AudioBitrate { get; set; }
    public int? AudioSampleRate { get; set; }
    public int AudioTracks { get; set; }
    public string Duration { get; set; } = string.Empty;
}

public class PosterSheetJob
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string ItemId { get; set; } = string.Empty;
    public int Rows { get; set; }
    public int Cols { get; set; }
    public JobMode Mode { get; set; }
    public string Seed { get; set; } = string.Empty;
    public OverlaySettings Overlay { get; set; } = new();
    public JobStatus Status { get; set; } = JobStatus.Queued;
    public int Progress { get; set; }
    public int Total { get; set; }
    public string? OutputPath { get; set; }
    public MediaInfoDto? MediaInfo { get; set; }
    public string? Error { get; set; }
    public CancellationTokenSource Cts { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
