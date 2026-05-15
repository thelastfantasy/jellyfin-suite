using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.JellyfinRecents.Models;
using Jellyfin.Plugin.JellyfinRecents.Services;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Controllers;

[ApiController]
[Route("JellyfinRecents/PosterSheet")]
[Authorize]
public class PosterSheetController : ControllerBase
{
    private readonly PosterSheetJobService _jobService;
    private readonly FontAcquisitionService _fontService;
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<PosterSheetController> _logger;

    public PosterSheetController(
        PosterSheetJobService jobService,
        FontAcquisitionService fontService,
        ILibraryManager libraryManager,
        ILogger<PosterSheetController> logger)
    {
        _jobService = jobService;
        _fontService = fontService;
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <summary>
    /// Start (or return existing) poster sheet generation job for an item.
    /// </summary>
    [HttpPost("{itemId}")]
    [ProducesResponseType(typeof(StartJobResponseDto), StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public IActionResult StartJob(string itemId, [FromBody] PosterSheetRequestDto req)
    {
        if (!Guid.TryParse(itemId, out var itemGuid))
            return BadRequest("Invalid itemId format.");

        var item = _libraryManager.GetItemById(itemGuid);
        if (item is null)
            return NotFound($"Item {itemId} not found.");

        // Must be a video with valid runtime
        if (item.MediaType != MediaType.Video)
            return UnprocessableEntity("Item is not a video.");

        if (!item.RunTimeTicks.HasValue || item.RunTimeTicks.Value <= 0)
            return UnprocessableEntity("Item has no valid duration.");

        var durationSeconds = item.RunTimeTicks.Value / 10_000_000.0;
        var requiredFrames = req.Rows * req.Cols;
        var maxFrames = (int)Math.Floor(durationSeconds / 2.0);

        // Require at least 2 seconds per frame (min spacing)
        if (requiredFrames > maxFrames)
            return BadRequest(
                $"Grid too large for video duration. Maximum {maxFrames} frames (2s spacing). Requested: {requiredFrames}.");

        var inputPath = item.Path;
        if (string.IsNullOrEmpty(inputPath))
            return UnprocessableEntity("Item has no file path.");

        var job = _jobService.GetOrCreateJob(itemId, req, inputPath);

        return Accepted(new StartJobResponseDto { JobId = job.Id });
    }

    /// <summary>
    /// Get status of a poster sheet job.
    /// </summary>
    [HttpGet("{jobId}/status")]
    [ProducesResponseType(typeof(PosterSheetStatusDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult GetStatus(string jobId)
    {
        var job = _jobService.GetJob(jobId);
        if (job is null)
            return NotFound($"Job {jobId} not found.");

        return Ok(new PosterSheetStatusDto
        {
            JobId = job.Id,
            ItemId = job.ItemId,
            Status = job.Status.ToString().ToLowerInvariant(),
            Progress = job.Progress,
            Total = job.Total,
            Error = job.Error,
            MediaInfo = job.MediaInfo,
        });
    }

    /// <summary>
    /// Download the completed poster sheet image.
    /// </summary>
    [HttpGet("{jobId}/image")]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public IActionResult GetImage(string jobId)
    {
        var job = _jobService.GetJob(jobId);
        if (job is null)
            return NotFound($"Job {jobId} not found.");

        if (job.Status != JobStatus.Done)
            return Conflict($"Job is not complete (status: {job.Status}).");

        if (string.IsNullOrEmpty(job.OutputPath) || !System.IO.File.Exists(job.OutputPath))
            return NotFound("Output file not found.");

        var bytes = System.IO.File.ReadAllBytes(job.OutputPath);
        return File(bytes, "image/jpeg");
    }

    /// <summary>
    /// Server-Sent Events stream for real-time job progress.
    /// Authenticate via ?api_key= query param (EventSource cannot set custom headers).
    /// </summary>
    [HttpGet("{jobId}/stream")]
    public async Task StreamStatus(string jobId, CancellationToken cancellationToken)
    {
        var job = _jobService.GetJob(jobId);
        if (job is null)
        {
            Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        Response.Headers["Content-Type"] = "text/event-stream; charset=utf-8";
        Response.Headers["Cache-Control"] = "no-cache, no-store";
        Response.Headers["X-Accel-Buffering"] = "no";

        var serializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        };

        while (!cancellationToken.IsCancellationRequested)
        {
            var dto = new PosterSheetStatusDto
            {
                JobId = job.Id,
                ItemId = job.ItemId,
                Status = job.Status.ToString().ToLowerInvariant(),
                Progress = job.Progress,
                Total = job.Total,
                Error = job.Error,
                MediaInfo = job.MediaInfo,
            };

            var json = JsonSerializer.Serialize(dto, serializerOptions);
            var payload = Encoding.UTF8.GetBytes($"data: {json}\n\n");

            try
            {
                await Response.Body.WriteAsync(payload, cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            if (job.Status is JobStatus.Done or JobStatus.Error or JobStatus.Cancelled)
                break;

            try
            {
                await Task.Delay(500, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>
    /// Cancel a running or queued job.
    /// </summary>
    [HttpDelete("{jobId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult CancelJob(string jobId)
    {
        var job = _jobService.GetJob(jobId);
        if (job is null)
            return NotFound($"Job {jobId} not found.");

        _jobService.CancelJob(jobId);
        return NoContent();
    }

    /// <summary>
    /// Generate a preview image for overlay settings (synchronous, short-lived).
    /// AllowAnonymous: stateless sample image, no user data involved (FR-031).
    /// </summary>
    [HttpPost("preview")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Preview([FromBody] PreviewRequestDto req)
    {
        var binaryPath = PosterSheetJobService.GetBinaryPath();
        if (!System.IO.File.Exists(binaryPath))
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                "poster-gen binary not available.");

        // Require at least one font to be ready
        if (_fontService.NotoSansPath is null && _fontService.NotoSerifPath is null)
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                "Fonts are not yet available. Please retry shortly.");

        var tempOutput = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            $"postersheet-preview-{Guid.NewGuid():N}.jpg");

        try
        {
            var args = _jobService.BuildPreviewArgs(req, tempOutput);
            _logger.LogInformation("Preview args: {Binary} {Args}", binaryPath, args);

            var psi = new System.Diagnostics.ProcessStartInfo(binaryPath, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            using var process = System.Diagnostics.Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to start poster-gen");

            cts.Token.Register(() => { try { process.Kill(); } catch { } });

            string? errorLine = null;
            bool done = false;

            // Read stderr in parallel to prevent pipe-buffer deadlock
            var stderrTask = process.StandardError.ReadToEndAsync();

            string? line;
            while ((line = await process.StandardOutput.ReadLineAsync()) != null)
            {
                if (line.StartsWith("DONE", StringComparison.Ordinal)) done = true;
                else if (line.StartsWith("ERROR ", StringComparison.Ordinal)) errorLine = line[6..];
            }

            var stderrOutput = await stderrTask;
            await process.WaitForExitAsync(cts.Token);

            if (!string.IsNullOrWhiteSpace(stderrOutput))
                _logger.LogWarning("Preview stderr: {Stderr}", stderrOutput);

            if (!done || !System.IO.File.Exists(tempOutput))
            {
                var err = errorLine
                    ?? (string.IsNullOrWhiteSpace(stderrOutput) ? null : stderrOutput.Trim())
                    ?? $"poster-gen exited with code {process.ExitCode}";
                _logger.LogError("Preview failed: {Error}", err);
                return BadRequest($"Preview generation failed: {err}");
            }

            var bytes = await System.IO.File.ReadAllBytesAsync(tempOutput);
            return File(bytes, "image/jpeg");
        }
        finally
        {
            if (System.IO.File.Exists(tempOutput))
                try { System.IO.File.Delete(tempOutput); } catch { }
        }
    }

    /// <summary>
    /// Check whether a poster sheet is already cached for given parameters.
    /// </summary>
    [HttpGet("cache/{itemId}")]
    [ProducesResponseType(typeof(CacheCheckResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public IActionResult CheckCache(
        string itemId,
        [FromQuery] int rows,
        [FromQuery] int cols,
        [FromQuery] string seed,
        [FromQuery] string overlayHash)
    {
        if (_jobService.TryGetCachedPath(itemId, rows, cols, seed, overlayHash, out _))
        {
            // Also check for an existing job with the same params
            var existingJob = _jobService.GetJob(itemId);  // by itemId if any
            return Ok(new CacheCheckResponseDto { Cached = true, JobId = existingJob?.Id });
        }

        return NoContent();
    }
}
