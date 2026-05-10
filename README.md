# Jellyfin Recents

A Jellyfin plugin that provides a customizable recently-played view with flexible grouping and sorting.

[中文文档](README.zh-CN.md)

---

## Features

- **Grouping**: Browse play history grouped by day / week / month / quarter / year
- **Sorting**: Play time, title, release date, favorites-first
- **Media filter**: All / video / audio
- **Dedup mode**: Show only the latest play per title
- **View modes**: Thumbnail / poster / list
- **Full pagination**: First / prev / jump / next / last

---

## Installation

### Plugin Repository (recommended)

1. Open Jellyfin dashboard → **Plugins** → **Repositories**
2. Add repository URL:
   ```
   https://thelastfantasy.github.io/jellyfin-recents/manifest.json
   ```
3. Find **Jellyfin Recents** in the **Catalog** and install
4. Restart Jellyfin

### Manual

1. Download the latest `.zip` from [Releases](https://github.com/thelastfantasy/jellyfin-recents/releases)
2. Extract to your Jellyfin plugins directory:
   - Linux: `/var/lib/jellyfin/plugins/JellyfinRecents/`
   - Windows: `%APPDATA%\Jellyfin\plugins\JellyfinRecents\`
   - Docker: `/config/plugins/JellyfinRecents/`
3. Restart Jellyfin

After installation, a **Recently Played** entry will appear in the sidebar.

---

## Compatibility

| Plugin version | Minimum Jellyfin |
|----------------|------------------|
| 1.x            | 10.8.0           |

---

## Development

```bash
# Start frontend dev server (requires a local Jellyfin instance)
cd src/frontend
npm install
npm run dev

# Build plugin
npm run build   # compile frontend
dotnet build    # compile C#
```

Copy `.env.example` to `.env` and set your Jellyfin URL:

```
VITE_JELLYFIN_URL=http://localhost:8096
```
