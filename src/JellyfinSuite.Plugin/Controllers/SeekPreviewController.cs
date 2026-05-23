using System.Text;
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
            _seekPreview.Prefetch(filePath, positionMs, width, itemId);
            return Ok();
        }

        var jpeg = await _seekPreview.FetchAsync(filePath, positionMs, width, itemId, cancellationToken);
        if (jpeg == null || jpeg.Length == 0)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "frame decode failed");

        return File(jpeg, "image/jpeg");
    }

    /// <summary>
    /// Server-Sent Events stream that emits positionMs values as frames become available on disk.
    /// The frontend subscribes once per video and uses events to warm the browser cache and
    /// populate _loadedKeys, enabling instant display during drag-seek.
    /// Authenticate via ?api_key= query param (EventSource cannot set custom headers).
    /// </summary>
    [HttpGet("{itemId}/ready-stream")]
    public async Task ReadyStream(
        [FromRoute] Guid itemId,
        CancellationToken cancellationToken)
    {
        if (!_seekPreview.IsAvailable)
        {
            Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            return;
        }

        var item = _libraryManager.GetItemById(itemId);
        if (item == null || string.IsNullOrEmpty(item.Path))
        {
            Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var durationMs = item.RunTimeTicks.HasValue
            ? item.RunTimeTicks.Value / TimeSpan.TicksPerMillisecond
            : 0L;

        if (durationMs <= 0)
        {
            Response.StatusCode = StatusCodes.Status204NoContent;
            return;
        }

        // Build the set of all 30-second-aligned positions for this video.
        var pending = new HashSet<long>();
        for (var ms = 0L; ms <= durationMs; ms += 30_000)
            pending.Add(ms);

        Response.Headers["Content-Type"] = "text/event-stream; charset=utf-8";
        Response.Headers["Cache-Control"] = "no-cache, no-store";
        Response.Headers["X-Accel-Buffering"] = "no";

        var cacheDir = Path.Combine(SeekPreviewService.CacheDirectory, itemId.ToString("N"));

        while (pending.Count > 0 && !cancellationToken.IsCancellationRequested)
        {
            List<long>? ready = null;
            foreach (var ms in pending)
            {
                if (System.IO.File.Exists(Path.Combine(cacheDir, $"{ms}.jpg")))
                    (ready ??= []).Add(ms);
            }

            if (ready != null)
            {
                foreach (var ms in ready)
                {
                    pending.Remove(ms);
                    var payload = Encoding.UTF8.GetBytes($"data: {ms}\n\n");
                    try
                    {
                        await Response.Body.WriteAsync(payload, cancellationToken);
                        await Response.Body.FlushAsync(cancellationToken);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }
                }
            }

            if (pending.Count > 0)
            {
                try { await Task.Delay(500, cancellationToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }
}
