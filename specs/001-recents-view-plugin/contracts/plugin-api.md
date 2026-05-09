# API Contracts: Jellyfin 最近播放视图插件

**Created**: 2026-05-09

---

## 插件自定义端点

### GET /JellyfinRecents/PlayHistory

返回当前认证用户的完整播放历史（含重复记录）。

**认证**: 需要有效的 Jellyfin Bearer Token（标准用户权限即可）

**查询参数**:

| 参数 | 类型 | 必须 | 说明 |
|-----|------|------|------|
| `startDate` | `string` (ISO 8601) | 否 | 起始时间过滤（含） |
| `endDate` | `string` (ISO 8601) | 否 | 结束时间过滤（含） |
| `mediaType` | `'Video' \| 'Audio' \| 'All'` | 否 | 媒体类型过滤，默认 `All` |
| `limit` | `number` | 否 | 最大返回条数，默认 1000 |

**响应体** (200 OK):

```json
{
  "entries": [
    {
      "itemId": "string",
      "playedDate": "2026-05-09T14:30:00Z"
    }
  ],
  "totalCount": 42
}
```

**错误响应**:

| 状态码 | 说明 |
|--------|------|
| 401 | 未认证或 Token 无效 |
| 500 | 服务端查询 Activity Log 失败 |

---

## 复用的 Jellyfin 标准 API

### GET /Users/{userId}/Items

用于"不含重复记录"模式（`showRepeats = false`）

**关键参数组合**:

```
filters=IsPlayed
sortBy=DatePlayed
sortOrder=Descending
includeItemTypes=Movie,Episode          (视频模式)
includeItemTypes=Audio,MusicVideo       (音频模式)
recursive=true
fields=DateCreated,UserData
startIndex={offset}
limit={batchSize}
```

**所需字段** (在 `fields` 参数中指定):
- `DateCreated` — 加入媒体库时间
- `UserData` — 包含 `LastPlayedDate`、`IsFavorite`

---

### 图片 URL 约定

缩略图通过 Jellyfin 图片 API 生成：

```
/Items/{itemId}/Images/Primary?maxWidth=320&quality=90
```

- 若 Primary 图不存在（剧集），回退到 `Backdrop`
- 由前端 `ImageUrlsApi` 工具类生成，不硬编码 URL

---

## 插件配置页面端点

插件通过 Jellyfin 内置机制提供配置页面：

```
GET /web/configurationpage?name=JellyfinRecents
```

- 返回嵌入在 DLL 中的 HTML 入口文件
- HTML 引用同样嵌入的 TypeScript bundle（`jellyfin-recents.js`）
- 页面在 Jellyfin Dashboard → 插件 → JellyfinRecents → 设置 中可访问

---

## 前端与 Jellyfin Web 的集成接口

前端通过 `window.ApiClient`（Jellyfin Web 全局对象）获取：

| 属性/方法 | 用途 |
|----------|------|
| `window.ApiClient.currentUserId()` | 获取当前用户 ID |
| `window.ApiClient.accessToken()` | 获取当前 Bearer Token |
| `window.ApiClient.serverAddress()` | 获取服务器基础 URL |

> 若 `window.ApiClient` 不存在（独立访问场景），前端显示"请从 Jellyfin Web 中访问此页面"提示。
