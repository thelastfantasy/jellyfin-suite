# Jellyfin Recents

A Jellyfin plugin that provides a customizable recently-played view with flexible grouping and sorting.

[中文文档](README.zh-CN.md)

---

## Features

- **Grouping**: Browse play history grouped by day / week / month / quarter / year
- **Sorting**: Play time, title, release date, favorites-first
- **Media filter**: All / video / audio
- **Dedup mode**: Hide repeated plays; optionally dedup within each group independently
- **Episode info**: Series name and episode code (S×E× / SP× for specials) shown on every card
- **Smart links**: Series name links to the series page; episode title links to the episode page
- **Folder view**: Click the folder icon on any thumbnail to open a popover showing the item's parent folder hierarchy with direct links — supports thumbnail, poster, and list view modes
- **View modes**: Thumbnail / poster / list
- **Full pagination**: First / prev / jump / next / last
- **Internationalization**: English, 简体中文, 日本語

> **Note:** This plugin records play activity from the point of installation onward. Pre-existing play history is not imported.

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
| 1.x            | 10.10.0          |

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

---

## AI Disclosure

This project was primarily developed with the assistance of an AI language model (Claude by Anthropic). In accordance with [Jellyfin's LLM policies](https://jellyfin.org/docs/general/contributing/llm-policies), this disclosure is provided so users can make an informed decision about whether to use this plugin.
