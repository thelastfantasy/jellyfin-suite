using System.Reflection;
using Jellyfin.Plugin.JellyfinRecents.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.JellyfinRecents;

/// <summary>
/// Jellyfin Recents plugin — provides a customizable recently-played view.
/// IMPORTANT: This GUID must never change after first release.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static readonly Guid StaticId = new("a6dd5650-d124-42b6-806a-5426f266e8f2");

    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Jellyfin Recents";

    public override Guid Id => StaticId;

    public override string Description =>
        "A customizable recently-played view with flexible grouping and sorting.";

    public IEnumerable<PluginPageInfo> GetPages()
    {
        var prefix = GetType().Assembly.GetName().Name + ".Web.";
        return
        [
            new PluginPageInfo
            {
                Name = "JellyfinRecents",
                EmbeddedResourcePath = prefix + "config.html",
                EnableInMainMenu = true,
                DisplayName = "最近播放",
                MenuSection = "user",
                MenuIcon = "schedule",
            },
            new PluginPageInfo
            {
                Name = "JellyfinRecentsBundle",
                EmbeddedResourcePath = prefix + "jellyfin-recents.js",
            }
        ];
    }
}
