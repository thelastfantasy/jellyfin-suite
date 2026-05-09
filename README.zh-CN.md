# Jellyfin Recents

Jellyfin 插件，提供可自定义的最近播放视图，支持灵活的分组与排序。

[English](README.md)

---

## 功能

- **分组浏览**：按日 / 周 / 月 / 季 / 年分组展示播放记录
- **多种排序**：播放时间、标题、发行日期、收藏优先
- **媒体筛选**：全部 / 视频 / 音频
- **去重模式**：可隐藏重复播放记录，每部作品只显示最近一次
- **视图模式**：缩略图 / 海报 / 列表
- **完整分页**：首页 / 上一页 / 跳转 / 下一页 / 末页

---

## 安装

### 通过插件仓库（推荐）

1. 打开 Jellyfin 管理后台 → **插件** → **仓库**
2. 添加仓库 URL：
   ```
   https://thelastfantasy.github.io/jellyfin-recents/manifest.json
   ```
3. 在**目录**中找到 **Jellyfin Recents**，点击安装
4. 重启 Jellyfin 服务

### 手动安装

1. 从 [Releases](https://github.com/thelastfantasy/jellyfin-recents/releases) 下载最新版本的 `.zip`
2. 解压到 Jellyfin 插件目录：
   - Linux：`/var/lib/jellyfin/plugins/JellyfinRecents/`
   - Windows：`%APPDATA%\Jellyfin\plugins\JellyfinRecents\`
   - Docker：`/config/plugins/JellyfinRecents/`
3. 重启 Jellyfin 服务

安装后，侧边栏会出现**最近播放**入口。

---

## 兼容性

| 插件版本 | Jellyfin 最低版本 |
|----------|------------------|
| 1.x      | 10.8.0           |

---

## 开发

```bash
# 启动前端开发服务器（需要本地 Jellyfin 实例）
cd src/frontend
npm install
npm run dev

# 构建插件
npm run build   # 编译前端
dotnet build    # 编译 C#
```

复制 `.env.example` 为 `.env` 并配置 Jellyfin 地址：

```
VITE_JELLYFIN_URL=http://localhost:8096
```
