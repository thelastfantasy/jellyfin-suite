using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.JellyfinSuite.Configuration;

/// <summary>
/// Plugin configuration for Jellyfin Suite.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Whether to automatically inject the player enhancer ESM bundle into config.json on startup.
    /// Set to false when the user has explicitly removed the injection via the management UI.
    /// </summary>
    public bool AutoInjectEnabled { get; set; } = true;

    /// <summary>
    /// Number of seconds to seek on mobile double-tap gesture. Default 10.
    /// </summary>
    public double SeekSeconds { get; set; } = 10;
}
