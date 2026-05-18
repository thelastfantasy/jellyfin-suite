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
        return Ok(new EnhancerStatusDto
        {
            AutoInjectEnabled = Plugin.Instance?.Configuration.AutoInjectEnabled ?? true,
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

            PlayerEnhancerEntryPoint.PatchConfigJson(
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

            PlayerEnhancerEntryPoint.RemoveFromConfigJson(
                _appPaths.WebPath,
                PlayerEnhancerEntryPoint.EnhancerUrl);

            return Ok();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PlayerEnhancer: failed to remove injection");
            return StatusCode(500, ex.Message);
        }
    }
}

public sealed class EnhancerStatusDto
{
    public bool AutoInjectEnabled { get; set; }
}
