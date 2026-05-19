using System.Text.Json.Serialization;
using MediaBrowser.Common.Configuration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinSuite.Controllers;

[ApiController]
[Route("JellyfinSuite/PlayerEnhancer")]
[Authorize(Policy = "RequiresElevation")]
public class PlayerEnhancerController : ControllerBase
{
    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<PlayerEnhancerController> _logger;

    public PlayerEnhancerController(
        IApplicationPaths appPaths,
        ILogger<PlayerEnhancerController> logger)
    {
        _appPaths = appPaths;
        _logger = logger;
    }

    [HttpGet("Status")]
    [ProducesResponseType(typeof(EnhancerStatusDto), StatusCodes.Status200OK)]
    public ActionResult<EnhancerStatusDto> GetStatus()
    {
        var indexPath = Path.Combine(_appPaths.WebPath, "index.html");
        var injected = System.IO.File.Exists(indexPath) &&
            System.IO.File.ReadAllText(indexPath).Contains("/web/configurationpage?name=JellyfinSuitePlayerEnhancer");

        return Ok(new EnhancerStatusDto
        {
            AutoInjectEnabled = injected,
        });
    }

    [HttpPost("Inject")]
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

    [HttpGet("GestureConfig")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(GestureConfigDto), StatusCodes.Status200OK)]
    public ActionResult<GestureConfigDto> GetGestureConfig()
    {
        return Ok(new GestureConfigDto
        {
            SeekSeconds = Plugin.Instance?.Configuration.SeekSeconds ?? 10,
            SpeedRate   = Plugin.Instance?.Configuration.SpeedRate   ?? 2.0,
        });
    }

    [HttpPatch("GestureConfig")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult SetGestureConfig([FromBody] GestureConfigDto dto)
    {
        var config = Plugin.Instance!.Configuration;
        config.SeekSeconds = Math.Clamp(dto.SeekSeconds, 0.5, 30.0);
        config.SpeedRate   = Math.Clamp(dto.SpeedRate,   1.25, 4.0);
        Plugin.Instance.SaveConfiguration();
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
    [JsonPropertyName("seekSeconds")]
    public double SeekSeconds { get; set; }

    [JsonPropertyName("speedRate")]
    public double SpeedRate { get; set; } = 2.0;
}
