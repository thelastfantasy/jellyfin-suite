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
    private readonly SeekPreviewBatchService _batchService;
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<SeekPreviewController> _logger;

    public SeekPreviewController(
        SeekPreviewService seekPreview,
        SeekPreviewBatchService batchService,
        ILibraryManager libraryManager,
        ILogger<SeekPreviewController> logger)
    {
        _seekPreview = seekPreview;
        _batchService = batchService;
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
    /// Frame generation continues in the background even after this stream disconnects.
    /// </summary>
    [HttpGet("{itemId}/ready-stream")]
    public async Task ReadyStream(
        [FromRoute] Guid itemId,
        [FromQuery] long positionMs = 0,
        CancellationToken cancellationToken = default)
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

        await _seekPreview.EnsureStartedAsync(cancellationToken);

        var itemIdStr = itemId.ToString("N");
        var filePath = item.Path;

        // Register with batch service: set priority center and enqueue pending frames.
        // Batch continues even after this SSE stream disconnects.
        _batchService.SetActive(itemIdStr, positionMs);
        _batchService.Enqueue(itemIdStr, filePath, durationMs);

        Response.Headers["Content-Type"] = "text/event-stream; charset=utf-8";
        Response.Headers["Cache-Control"] = "no-cache, no-store";
        Response.Headers["X-Accel-Buffering"] = "no";

        var cacheDir = Path.Combine(SeekPreviewService.CacheDirectory, itemIdStr);
        var seen = new HashSet<long>();

        // Subscribe BEFORE scanning disk to avoid missing notifications during the scan.
        var (channel, unsub) = _batchService.Subscribe(itemIdStr);
        using (unsub)
        {
            // Emit frames already on disk immediately (these were generated in a previous session).
            for (var ms = 0L; ms <= durationMs; ms += 30_000)
            {
                if (!System.IO.File.Exists(Path.Combine(cacheDir, $"{ms}.jpg"))) continue;
                seen.Add(ms);
                try
                {
                    await Response.Body.WriteAsync(Encoding.UTF8.GetBytes($"data: {ms}\n\n"), cancellationToken);
                }
                catch (OperationCanceledException) { return; }
            }

            try { await Response.Body.FlushAsync(cancellationToken); }
            catch (OperationCanceledException) { return; }

            // Stream new completions from the batch service.
            await foreach (var ms in channel.Reader.ReadAllAsync(cancellationToken))
            {
                if (!seen.Add(ms)) continue; // skip if already sent in initial scan

                try
                {
                    await Response.Body.WriteAsync(Encoding.UTF8.GetBytes($"data: {ms}\n\n"), cancellationToken);
                    await Response.Body.FlushAsync(cancellationToken);
                }
                catch (OperationCanceledException) { return; }
            }
        }
    }
}
