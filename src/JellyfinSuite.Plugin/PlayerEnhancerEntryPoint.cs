using System.Text.Json;
using System.Text.Json.Nodes;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinSuite;

/// <summary>
/// Hosted service that patches Jellyfin's web config.json on startup to auto-load the player enhancer ESM bundle.
/// </summary>
public class PlayerEnhancerEntryPoint : IHostedService
{
    internal const string EnhancerUrl =
        "/web/configurationpage?name=JellyfinSuitePlayerEnhancer";

    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<PlayerEnhancerEntryPoint> _logger;

    public PlayerEnhancerEntryPoint(
        IApplicationPaths appPaths,
        ILogger<PlayerEnhancerEntryPoint> logger)
    {
        _appPaths = appPaths;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (Plugin.Instance?.Configuration.AutoInjectEnabled == false)
        {
            _logger.LogDebug("PlayerEnhancer auto-inject skipped: disabled by user");
            return Task.CompletedTask;
        }

        try
        {
            var changed = PatchConfigJson(_appPaths.WebPath, EnhancerUrl);
            if (changed)
                _logger.LogInformation("PlayerEnhancer: injected enhancer URL into config.json");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PlayerEnhancer: failed to patch config.json");
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>
    /// Idempotently adds <paramref name="url"/> to the plugins array in config.json.
    /// Returns true if the file was modified, false if the URL was already present.
    /// </summary>
    internal static bool PatchConfigJson(string webPath, string url)
    {
        var configPath = Path.Combine(webPath, "config.json");
        if (!File.Exists(configPath)) return false;

        var json = File.ReadAllText(configPath);
        var node = JsonNode.Parse(json);
        if (node is not JsonObject obj) return false;

        var plugins = obj["plugins"]?.AsArray();
        if (plugins is null)
        {
            plugins = new JsonArray();
            obj["plugins"] = plugins;
        }

        foreach (var item in plugins)
        {
            if (item is JsonValue val && val.TryGetValue<string>(out var s) && s == url)
                return false; // already present
        }

        plugins.Add(url);
        WriteIndented(configPath, obj);
        return true;
    }

    /// <summary>
    /// Removes <paramref name="url"/> from the plugins array in config.json.
    /// Returns true if the file was modified.
    /// </summary>
    internal static bool RemoveFromConfigJson(string webPath, string url)
    {
        var configPath = Path.Combine(webPath, "config.json");
        if (!File.Exists(configPath)) return false;

        var json = File.ReadAllText(configPath);
        var node = JsonNode.Parse(json);
        if (node is not JsonObject obj) return false;

        var plugins = obj["plugins"]?.AsArray();
        if (plugins is null) return false;

        for (var i = plugins.Count - 1; i >= 0; i--)
        {
            if (plugins[i] is JsonValue val && val.TryGetValue<string>(out var s) && s == url)
            {
                plugins.RemoveAt(i);
                WriteIndented(configPath, obj);
                return true;
            }
        }

        return false;
    }

    private static void WriteIndented(string path, JsonNode node)
    {
        using var ms = new System.IO.MemoryStream();
        using var writer = new Utf8JsonWriter(ms, new JsonWriterOptions { Indented = true });
        node.WriteTo(writer);
        writer.Flush();
        File.WriteAllBytes(path, ms.ToArray());
    }
}
