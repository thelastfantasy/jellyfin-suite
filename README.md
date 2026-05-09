# Jellyfin Recents

A Jellyfin plugin that provides a customizable recently-played view with flexible grouping and sorting.

Jellyfin 插件，提供可自定义的最近播放视图，支持灵活的分组与排序。

---

## Features / 功能

- **Grouping** / **分组浏览**：Group play history by day / week / month / quarter / year — 按日 / 周 / 月 / 季 / 年分组
- **Sorting** / **多种排序**：Play time, title, release date, favorites-first — 播放时间、标题、发行日期、收藏优先
- **Media filter** / **媒体筛选**：All / video / audio — 全部 / 视频 / 音频
- **Dedup mode** / **去重模式**：Show only the latest play per title — 每部作品只显示最近一次
- **View modes** / **视图模式**：Thumbnail / poster / list — 缩略图 / 海报 / 列表
- **Full pagination** / **完整分页**：First / prev / jump / next / last — 首页 / 上一页 / 跳转 / 下一页 / 末页

---

## Installation / 安装

### Plugin Repository (recommended) / 插件仓库（推荐）

1. Open Jellyfin dashboard → **Plugins** → **Repositories**
   打开 Jellyfin 管理后台 → **插件** → **仓库**
2. Add repository URL / 添加仓库 URL：
   ```
   https://thelastfantasy.github.io/jellyfin-recents/manifest.json
   ```
3. Find **Jellyfin Recents** in the **Catalog** and install
   在**目录**中找到 **Jellyfin Recents**，点击安装
4. Restart Jellyfin / 重启 Jellyfin 服务

### Manual / 手动安装

1. Download the latest `.zip` from [Releases](https://github.com/thelastfantasy/jellyfin-recents/releases)
   从 Releases 下载最新版本的 `.zip`
2. Extract to your Jellyfin plugins directory / 解压到插件目录：
   - Linux: `/var/lib/jellyfin/plugins/JellyfinRecents/`
   - Windows: `%APPDATA%\Jellyfin\plugins\JellyfinRecents\`
   - Docker: `/config/plugins/JellyfinRecents/`
3. Restart Jellyfin / 重启 Jellyfin 服务

After installation, a **Recently Played** entry will appear in the sidebar.
安装后，侧边栏会出现**最近播放**入口。

---

## Compatibility / 兼容性

| Plugin version / 插件版本 | Minimum Jellyfin / Jellyfin 最低版本 |
|--------------------------|--------------------------------------|
| 1.x                      | 10.8.0                               |

---

## Development / 开发

```bash
# Start frontend dev server (requires a local Jellyfin instance)
# 启动前端开发服务器（需要本地 Jellyfin 实例）
cd src/frontend
npm install
npm run dev

# Build plugin / 构建插件
npm run build   # compile frontend / 编译前端
dotnet build    # compile C# / 编译 C#
```

Copy `.env.example` to `.env` and set your Jellyfin URL:
复制 `.env.example` 为 `.env` 并配置 Jellyfin 地址：

```
VITE_JELLYFIN_URL=http://localhost:8096
```
