using Jellyfin.Plugin.JellyfinSuite.Data;
using Jellyfin.Plugin.JellyfinSuite.Events;
using Jellyfin.Plugin.JellyfinSuite.i18n;
using Jellyfin.Plugin.JellyfinSuite.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Events;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.JellyfinSuite;

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
            var dbPath = Path.Combine(appPaths.DataPath, PluginConstants.DatabaseFileName);
            var legacyPath = Path.Combine(appPaths.DataPath, PluginConstants.DatabaseFileNameLegacy);
            RecentsDatabase.MigrateFromLegacy(legacyPath, dbPath, logger);
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

        // FontAcquisitionService: 先注册为 Singleton（供 Controller/JobService 注入），
        // 再用同一实例注册为 IHostedService（触发 StartAsync/StopAsync 生命周期）
        serviceCollection.AddSingleton<FontAcquisitionService>(sp =>
        {
            var appPaths = applicationHost.Resolve<MediaBrowser.Common.Configuration.IApplicationPaths>();
            var logger = sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<FontAcquisitionService>>();
            return new FontAcquisitionService(appPaths, logger);
        });
        serviceCollection.AddHostedService(sp => sp.GetRequiredService<FontAcquisitionService>());

        // PosterSheetJobService: 同上模式
        serviceCollection.AddSingleton<PosterSheetJobService>(sp =>
        {
            var appPaths = applicationHost.Resolve<MediaBrowser.Common.Configuration.IApplicationPaths>();
            var logger = sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<PosterSheetJobService>>();
            var fontSvc = sp.GetRequiredService<FontAcquisitionService>();
            return new PosterSheetJobService(appPaths, logger, fontSvc);
        });

        // 注入 IHttpContextAccessor 供 i18n 读取浏览器语言
        serviceCollection.AddHttpContextAccessor();
        serviceCollection.AddSingleton<IStartupFilter, TaskStringsInitializer>();
    }
}

/// <summary>
/// 在应用启动后设置 TaskStrings 的 HttpContext 访问器。
/// </summary>
internal class TaskStringsInitializer : IStartupFilter
{
    private readonly IHttpContextAccessor _accessor;
    public TaskStringsInitializer(IHttpContextAccessor accessor) => _accessor = accessor;
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        TaskStrings.SetHttpAccessor(_accessor);
        next(app);
    };
}
