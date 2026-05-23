using Jellyfin.Plugin.JellyfinSuite.Services;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinSuite.Controllers;

[ApiController]
[Route("JellyfinSuite/SeekPreview")]
[AllowAnonymous]
public class SeekPreviewController : ControllerBase
{
    private const int DefaultWidth = 320;

    private readonly SeekPreviewService _seekPreview;
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<SeekPreviewController> _logger;

    public SeekPreviewController(
        SeekPreviewService seekPreview,
        ILibraryManager libraryManager,
        ILogger<SeekPreviewController> logger)
    {
        _seekPreview = seekPreview;
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <summary>
    /// Returns a JPEG frame for the given item at positionMs.
    /// Add &amp;prefetch=true to trigger background caching without waiting for JPEG.
    /// </summary>
    [HttpGet("{itemId}")]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> GetFrame(
        [FromRoute] Guid itemId,
        [FromQuery] long positionMs = 0,
        [FromQuery] bool prefetch = false,
        [FromQuery] int width = DefaultWidth,
        CancellationToken cancellationToken = default)
    {
        if (!_seekPreview.IsAvailable)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "seek-preview not available");

        await _seekPreview.EnsureStartedAsync(cancellationToken);

        var item = _libraryManager.GetItemById(itemId);
        if (item == null)
            return NotFound();

        var filePath = item.Path;
        if (string.IsNullOrEmpty(filePath) || !System.IO.File.Exists(filePath))
            return NotFound();

        if (prefetch)
        {
            _seekPreview.Prefetch(filePath, positionMs, width);
            return Ok();
        }

        var jpeg = await _seekPreview.FetchAsync(filePath, positionMs, width, cancellationToken);
        if (jpeg == null || jpeg.Length == 0)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "frame decode failed");

        return File(jpeg, "image/jpeg");
    }
}
