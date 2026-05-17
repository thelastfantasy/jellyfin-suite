using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace Jellyfin.Plugin.JellyfinRecents.Models;

public class SkipSegmentDto
{
    public long StartMs { get; set; }
    public long EndMs { get; set; }
}

public class PosterSheetRequestDto
{
    [Range(1, 20)]
    public int Rows { get; set; } = 6;

    [Range(1, 12)]
    public int Cols { get; set; } = 8;

    public string Mode { get; set; } = "deterministic";

    public string? Seed { get; set; }

    public OverlaySettings Overlay { get; set; } = new();

    public List<SkipSegmentDto>? SkipSegments { get; set; }
}

public class PreviewRequestDto
{
    [Range(1, 20)]
    public int Rows { get; set; } = 6;

    [Range(1, 12)]
    public int Cols { get; set; } = 8;

    public OverlaySettings Overlay { get; set; } = new();
}
