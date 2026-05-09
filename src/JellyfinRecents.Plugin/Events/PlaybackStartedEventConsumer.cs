using Jellyfin.Data.Enums;
using Jellyfin.Plugin.JellyfinRecents.Data;
using MediaBrowser.Controller.Events;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyfinRecents.Events;

/// <summary>
/// 监听播放开始事件，将记录写入 SQLite play_history 表。
/// </summary>
public class PlaybackStartedEventConsumer : IEventConsumer<PlaybackStartEventArgs>
{
    private readonly RecentsDatabase _db;
    private readonly ILogger<PlaybackStartedEventConsumer> _logger;

    public PlaybackStartedEventConsumer(RecentsDatabase db, ILogger<PlaybackStartedEventConsumer> logger)
    {
        _db = db;
        _logger = logger;
    }

    public Task OnEvent(PlaybackStartEventArgs eventArgs)
    {
        try
        {
            var item = eventArgs.Item;
            if (item is null) return Task.CompletedTask;

            // 只记录视频和音频
            var mediaType = item.MediaType == MediaType.Audio ? "audio" : "video";

            foreach (var user in eventArgs.Users)
            {
                _db.InsertPlayRecord(user.Id, item.Id.ToString(), DateTime.UtcNow, mediaType);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to record playback start event");
        }

        return Task.CompletedTask;
    }
}
