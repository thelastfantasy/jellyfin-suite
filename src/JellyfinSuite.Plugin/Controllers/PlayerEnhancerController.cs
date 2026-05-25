using System.Text.Json.Serialization;
using Jellyfin.Plugin.JellyfinSuite.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinSuite.Controllers;

[ApiController]
[Route("JellyfinSuite/PlayerEnhancer")]
[Authorize]
public class PlayerEnhancerController : ControllerBase
{
    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<PlayerEnhancerController> _logger;
    private readonly UserSettingsService _userSettings;
    private readonly IAuthorizationContext _authContext;

    public PlayerEnhancerController(
        IApplicationPaths appPaths,
        ILogger<PlayerEnhancerController> logger,
        UserSettingsService userSettings,
        IAuthorizationContext authContext)
    {
        _appPaths = appPaths;
        _logger = logger;
        _userSettings = userSettings;
        _authContext = authContext;
    }

    /// <summary>Returns the Jellyfin user ID for the current request, or null if anonymous/system key.</summary>
    private async Task<string?> GetCurrentUserIdAsync()
    {
        try
        {
            var info = await _authContext.GetAuthorizationInfo(HttpContext);
            var id = info.UserId;
            return id == Guid.Empty ? null : id.ToString("N");
        }
        catch { return null; }
    }

    [HttpGet("Status")]
    [Authorize(Policy = "RequiresElevation")]
    [ProducesResponseType(typeof(EnhancerStatusDto), StatusCodes.Status200OK)]
    public ActionResult<EnhancerStatusDto> GetStatus()
    {
        var indexPath = Path.Combine(_appPaths.WebPath, "index.html");
        var injected = System.IO.File.Exists(indexPath) &&
            System.IO.File.ReadAllText(indexPath).Contains("/web/configurationpage?name=JellyfinSuitePlayerEnhancer");

        return Ok(new EnhancerStatusDto { AutoInjectEnabled = injected });
    }

    [HttpPost("Inject")]
    [Authorize(Policy = "RequiresElevation")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public ActionResult Inject()
    {
        try
        {
            var config = Plugin.Instance!.Configuration;
            config.AutoInjectEnabled = true;
            Plugin.Instance.SaveConfiguration();

            PlayerEnhancerEntryPoint.RemoveEnhancerTagsFromIndexHtml(_appPaths.WebPath);
            PlayerEnhancerEntryPoint.PatchIndexHtml(
                _appPaths.WebPath,
                PlayerEnhancerEntryPoint.EnhancerUrl);

            return Ok();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PlayerEnhancer: failed to inject");
            return StatusCode(500, ex.Message);
        }
    }

    [HttpDelete("Inject")]
    [Authorize(Policy = "RequiresElevation")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public ActionResult Remove()
    {
        try
        {
            var config = Plugin.Instance!.Configuration;
            config.AutoInjectEnabled = false;
            Plugin.Instance.SaveConfiguration();

            PlayerEnhancerEntryPoint.RemoveEnhancerTagsFromIndexHtml(_appPaths.WebPath);

            return Ok();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PlayerEnhancer: failed to remove injection");
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    /// Returns gesture/player config for the current user.
    /// Pass ?api_key= to receive user-specific settings; anonymous requests get plugin defaults.
    /// </summary>
    [HttpGet("GestureConfig")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(GestureConfigDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<GestureConfigDto>> GetGestureConfig()
    {
        var userId = await GetCurrentUserIdAsync();
        if (userId != null)
        {
            var s = _userSettings.Get(userId);
            return Ok(new GestureConfigDto
            {
                TrickplayEnabled = s.TrickplayEnabled,
                SeekSeconds = s.SeekSeconds,
                SpeedRate = s.SpeedRate,
            });
        }

        // Anonymous/system-key: return plugin-level defaults
        var cfg = Plugin.Instance?.Configuration;
        return Ok(new GestureConfigDto
        {
            TrickplayEnabled = true,
            SeekSeconds = cfg?.SeekSeconds ?? 10,
            SpeedRate = cfg?.SpeedRate ?? 2.0,
        });
    }

    /// <summary>
    /// Saves gesture/player config for the authenticated user. Any authenticated user may call this.
    /// </summary>
    [HttpPatch("GestureConfig")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult> SetGestureConfig([FromBody] GestureConfigDto dto)
    {
        var userId = await GetCurrentUserIdAsync();
        if (userId == null) return Unauthorized();

        _userSettings.Save(userId, new UserPlayerSettings
        {
            TrickplayEnabled = dto.TrickplayEnabled,
            SeekSeconds = Math.Clamp(dto.SeekSeconds, 0.5, 30.0),
            SpeedRate = Math.Clamp(dto.SpeedRate, 1.25, 4.0),
        });
        return NoContent();
    }
}

public sealed class EnhancerStatusDto
{
    [JsonPropertyName("autoInjectEnabled")]
    public bool AutoInjectEnabled { get; set; }
}

public sealed class GestureConfigDto
{
    [JsonPropertyName("trickplayEnabled")]
    public bool TrickplayEnabled { get; set; } = true;

    [JsonPropertyName("seekSeconds")]
    public double SeekSeconds { get; set; }

    [JsonPropertyName("speedRate")]
    public double SpeedRate { get; set; } = 2.0;
}
