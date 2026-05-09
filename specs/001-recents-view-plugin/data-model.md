# Data Model: Jellyfin 最近播放视图插件

**Created**: 2026-05-09
**Branch**: `001-recents-view-plugin`

---

## 核心实体

### PlayRecord（播放记录条目）

来源：Jellyfin Items API 或插件 PlayHistory API

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `itemId` | `string` | `BaseItemDto.Id` | Jellyfin 媒体 ID |
| `title` | `string` | `BaseItemDto.Name` | 媒体标题 |
| `seriesName` | `string \| null` | `BaseItemDto.SeriesName` | 剧集名（仅 Episode） |
| `thumbnailUrl` | `string` | 由 `ImageUrlsApi` 生成 | 缩略图 URL（Primary 图） |
| `playedDate` | `Date` | `UserData.LastPlayedDate` / ActivityLog | 本次播放时间 |
| `mediaType` | `'Video' \| 'Audio'` | `BaseItemDto.MediaType` | 媒体大类 |
| `subType` | `'Movie' \| 'Episode' \| 'Audio' \| 'MusicVideo'` | `BaseItemDto.Type` | 媒体细分类型 |
| `releaseYear` | `number \| null` | `BaseItemDto.ProductionYear` | 发行年份 |
| `addedDate` | `Date \| null` | `BaseItemDto.DateCreated` | 加入媒体库时间 |
| `isFavorite` | `boolean` | `UserData.IsFavorite` | 是否已收藏 |
| `isRepeat` | `boolean` | 计算得出 | 是否为重复播放记录（同一 itemId 在同分组内出现多次） |

---

### GroupedPage（分组分页）

前端计算生成，不来自 API

| 字段 | 类型 | 说明 |
|------|------|------|
| `groups` | `TimeGroup[]` | 当前页包含的所有时间分组 |
| `pageIndex` | `number` | 当前页码（0-based） |
| `totalPages` | `number` | 总页数 |
| `windowStart` | `Date` | 当前页时间窗口起始 |
| `windowEnd` | `Date` | 当前页时间窗口结束 |

### TimeGroup（单个时间分组）

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | `string` | 显示标签，如"2026年春季 (4-6月)" |
| `periodStart` | `Date` | 该分组起始时间 |
| `periodEnd` | `Date` | 该分组结束时间 |
| `records` | `PlayRecord[]` | 该分组内的播放记录（已排序） |

---

### ViewSettings（视图设置）

持久化至 localStorage，key: `jellyfin-recents-settings`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `groupBy` | `'day' \| 'week' \| 'month' \| 'quarter' \| 'year'` | `'week'` | 分组维度 |
| `sortBy` | `'title' \| 'playedDate' \| 'favorite' \| 'releaseYear' \| 'addedDate'` | `'playedDate'` | 排序字段（注：`favorite` 表示收藏优先排序） |
| `sortOrder` | `'asc' \| 'desc'` | `'desc'` | 排序方向 |
| `mediaFilter` | `'video' \| 'audio' \| 'all'` | `'video'` | 内容类型过滤 |
| `showRepeats` | `boolean` | `false` | 是否显示重复播放记录 |
| `pageIndex` | `number` | `0` | 当前页码（不持久化，重载归零） |

---

### PlayHistoryEntry（C# 插件 API 响应体）

插件自定义端点 `GET /JellyfinRecents/PlayHistory` 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `itemId` | `string` | Jellyfin 媒体 ID |
| `playedDate` | `string` | ISO 8601 时间戳（每次播放时间） |
| `userId` | `string` | 用户 ID（仅返回当前用户数据） |

---

## 分页规则

| `groupBy` | 每页时间跨度 | `windowSize`（页单位） |
|-----------|------------|----------------------|
| `day`     | 30 天      | 30 天 |
| `week`    | 13 周      | 91 天（≈1季度） |
| `month`   | 6 个月     | ~180 天 |
| `quarter` | 2 个季度   | ~180 天 |
| `year`    | 1 年       | 365 天 |

翻页方向：向"过去"翻，每翻一页 `windowEnd` 向前移动一个 `windowSize`

---

## 季度映射规则

```
月份 1-3  → 冬季
月份 4-6  → 春季
月份 7-9  → 夏季
月份 10-12 → 秋季
```

标签格式：`{年份}年{季节名} ({月}-{月}月)`
示例：`2026年春季 (4-6月)`

---

## 排序规则

| `sortBy` | 排序逻辑 | 空值处理 |
|---------|---------|---------|
| `title` | 标题字母序 | 无空值 |
| `playedDate` | 播放时间 | 无空值 |
| `favorite` | 已收藏的排前（desc） / 排后（asc） | 无空值（boolean） |
| `releaseYear` | 发行年份 | 无年份的条目排末尾 |
| `addedDate` | 加入媒体库时间 | null 排末尾 |

---

## 去重规则（`showRepeats = false`）

在每个 `TimeGroup` 内，对相同 `itemId` 的多条记录：
- 保留 `playedDate` 最大（最近）的那条
- 丢弃其余重复记录
- 去重后再执行排序
