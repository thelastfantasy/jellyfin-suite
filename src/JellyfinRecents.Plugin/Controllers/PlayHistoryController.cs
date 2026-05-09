using System.Security.Claims;
using Jellyfin.Plugin.JellyfinRecents.Models;
using Jellyfin.Plugin.JellyfinRecents.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JellyfinRecents.Controllers;

[ApiController]
[Route("JellyfinRecents")]
[Authorize]
public class PlayHistoryController : ControllerBase
{
    private readonly PlayHistoryService _playHistoryService;

    public PlayHistoryController(PlayHistoryService playHistoryService)
    {
        _playHistoryService = playHistoryService;
    }

    /// <summary>
    /// Gets paginated play history for the current authenticated user.
    /// </summary>
    [HttpGet("PlayHistory")]
    [ProducesResponseType(typeof(PlayHistoryResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<PlayHistoryResponse>> GetPlayHistory(
        [FromQuery] int page = 0,
        [FromQuery] int pageSize = 100,
        [FromQuery] string sortBy = "playedDate",
        [FromQuery] string sortOrder = "desc",
        [FromQuery] string? mediaType = null,
        [FromQuery] bool showRepeats = true)
    {
        var userIdStr = User.FindFirstValue("Jellyfin-UserId");
        if (!Guid.TryParse(userIdStr, out var userId) || userId == Guid.Empty)
            return Unauthorized();

        // 防止异常大的 pageSize
        pageSize = Math.Clamp(pageSize, 1, 500);

        var result = await _playHistoryService
            .GetPlayHistoryAsync(userId, page, pageSize, showRepeats, mediaType, sortBy, sortOrder)
            .ConfigureAwait(false);

        return Ok(result);
    }
}
