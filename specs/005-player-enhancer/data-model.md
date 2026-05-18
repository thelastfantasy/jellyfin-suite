# Data Model: Web Player Enhancer

> 本功能不引入新的服务端数据库表。所有状态均为前端运行时状态或插件启动期副作用（config.json 修补）。

---

## 运行时状态（前端，内存中）

### FpsCache
每个媒体项的帧率缓存，避免重复 API 调用。

| 字段 | 类型 | 说明 |
|------|------|------|
| `itemId` | `string` | Jellyfin 媒体项 ID（Map key） |
| `fps` | `number` | 帧率，来自 `RealFrameRate ?? AverageFrameRate ?? 24` |

**生命周期**: 随页面存活；`playbackstop` 时不清除（相同影片再次播放可复用）。

---

### SwipeGestureState
滑动调节手势的当前状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `active` | `boolean` | 是否正在进行滑动手势 |
| `side` | `'left' \| 'right' \| null` | 手势发生的半屏区域 |
| `startY` | `number` | `touchstart` 时的 Y 坐标（px） |
| `startValue` | `number` | 手势开始时的初始值（0–1，亮度或音量） |

---

### DoubleTapState
双击手势识别状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `lastTapTime` | `number` | 上次 `touchend` 的时间戳（`Date.now()`） |
| `lastTapSide` | `'left' \| 'right' \| null` | 上次点击的半屏区域 |
| `suppressNextTap` | `boolean` | 双击已识别，抑制后续单击事件 |

---

### EnhancerSessionState
播放器增强当前会话状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `currentBrightness` | `number` | 当前视频亮度（0.1–2.0，默认 1.0） |
| `injected` | `boolean` | 按钮 DOM 是否已注入当前播放器实例 |
| `currentItemId` | `string \| null` | 当前播放媒体的 Jellyfin ID |

---

## 服务端持久化配置（C#，插件配置机制）

### PluginConfiguration
Jellyfin `BasePlugin<T>` 自动 XML 序列化至插件配置目录，跨重启持久化。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `AutoInjectEnabled` | `bool` | `true` | 用户是否允许自动注入 enhancer URL；`false` 时 `StartAsync()` 跳过 config.json 修补 |

**生命周期**: 随插件安装持久；用户通过管理 UI 的"重新注入"（→ `true`）/ "卸载注入"（→ `false`）更改，`Plugin.Instance.SaveConfiguration()` 立即写入磁盘。  
**读取时机**: `PlayerEnhancerEntryPoint.StartAsync()`（服务启动时）和 `PlayerEnhancerController`（API 调用时）均读取此值。  
**文件位置**: `IApplicationPaths.PluginConfigurationsPath/JellyfinRecents.xml`（Jellyfin 框架管理，不直接操作文件）。

---

## 服务端副作用（C# 启动时）

### config.json 修补
不新增数据表，仅在服务启动时对 Jellyfin web 目录的 `config.json` 文件进行单次修补。

**修补前**（Jellyfin 默认）：
```json
{
  "plugins": [
    "jellyfin-plugin-playstate/plugin"
  ]
}
```

**修补后**：
```json
{
  "plugins": [
    "jellyfin-plugin-playstate/plugin",
    "/web/configurationpage?name=JellyfinRecentsPlayerEnhancer"
  ]
}
```

**幂等性**：`StartAsync()` 每次执行前检查 URL 是否已存在，避免重复追加。  
**回滚**：插件卸载时理论上应移除该条目，但 Jellyfin 插件无卸载钩子；用户手动删除插件后 config.json 遗留一条无效 URL，Jellyfin 的 `import()` 失败时静默跳过（不影响功能）。

---

## Jellyfin API 依赖（只读，不新增）

| 端点 | 用途 | 调用方 |
|------|------|--------|
| `GET /Items/{itemId}` | 获取媒体项帧率信息 | 前端，帧步进首次使用时 |
| `window.ApiClient` | Jellyfin 全局 API 客户端 | 前端，注入时已全局可用 |
| `playbackManager.currentItem()` | 获取当前播放媒体项 | 前端，构造函数注入 |
