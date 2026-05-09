using Jellyfin.Plugin.JellyfinRecents.Data;
using Jellyfin.Plugin.JellyfinRecents.Events;
using Jellyfin.Plugin.JellyfinRecents.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Events;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.JellyfinRecents;

/// <summary>
/// Registers plugin services with Jellyfin's DI container.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // RecentsDatabase 是单例——整个进程共享同一数据库连接字符串
        serviceCollection.AddSingleton<RecentsDatabase>(sp =>
        {
            var appPaths = applicationHost.Resolve<MediaBrowser.Common.Configuration.IApplicationPaths>();
            var logger = sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<RecentsDatabase>>();
            var dbPath = Path.Combine(appPaths.DataPath, "jellyfin-recents.db");
            var db = new RecentsDatabase(dbPath, logger);
            db.Initialize();
            return db;
        });

        serviceCollection.AddScoped<PlayHistoryService>();

        // 播放事件：经过 IEventManager，可用 IEventConsumer<T>
        serviceCollection.AddTransient<IEventConsumer<PlaybackStartEventArgs>, PlaybackStartedEventConsumer>();

        // 收藏事件：IUserDataManager.UserDataSaved 是老式 C# event，不经过 IEventManager，
        // 必须用 IHostedService 手动订阅
        serviceCollection.AddHostedService<FavoriteEntryPoint>();
    }
}
