using System.ComponentModel.DataAnnotations;

namespace Jellyfin.Plugin.JellyfinRecents.Models;

public class PosterSheetRequestDto
{
    [Range(1, 10)]
    public int Rows { get; set; } = 6;

    [Range(1, 12)]
    public int Cols { get; set; } = 8;

    public string Mode { get; set; } = "deterministic";

    public string? Seed { get; set; }

    public OverlaySettings Overlay { get; set; } = new();
}

public class PreviewRequestDto
{
    [Range(1, 10)]
    public int Rows { get; set; } = 6;

    [Range(1, 12)]
    public int Cols { get; set; } = 8;

    public OverlaySettings Overlay { get; set; } = new();
}
