# Implementation Plan: Trickplay Seek Preview

**Branch**: `fix/issue-43-bugs` | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/008-trickplay-seek-preview/spec.md`

## Summary

在长按加速横滑 seek 手势（spec 007）停顿 150ms 后，于速度 OSD 下方实时显示精确帧缩略图。采用自定义 Rust daemon（ffmpeg-next crate 内存解码，无临时文件）替代 Jellyfin 原生 Trickplay sprite sheet，通过 Unix domain socket 与 C# 端点通信，前端速度检测驱动预取。

## Technical Context

**Language/Version**: Rust 1.88 (seek-preview daemon) + TypeScript (player-enhancer) + C# .NET 8 (plugin 端点)  
**Primary Dependencies**:
- Rust: `tokio`（async runtime）、`ffmpeg-next`（内存帧解码）、`lru`（LruCache）、`num_cpus`、`anyhow`
- C#: .NET 8 内置 `System.Net.Sockets.Socket`（Unix domain socket，`AddressFamily.Unix`）
- TypeScript: 无新外部依赖，使用 `fetch` API

**Storage**: Rust daemon 内存 LruCache（50 条，key = `(PathBuf, pos_ms/500*500)`）；C# 侧无持久化  
**Testing**: `make test` — `cargo test`（seek-preview）+ TypeScript 编译 + C# 编译；手动端到端验证  
**Target Platform**: Jellyfin Docker 容器（Linux x64）；前端移动端 Chrome/Safari  
**Performance Goals**: 缓存命中时缩略图在 10ms 内出现；缓存未命中时 120ms 内出现（含 Rust 解码 ~50ms + 网络往返 ~20ms）；touchmove 手势增量延迟 < 5ms（SC-005）  
**Constraints**: Jellyfin Docker 镜像已含 libavcodec/libavformat/libswscale，无需额外安装；Unix domain socket 需 .NET 6+（Jellyfin 用 .NET 8，满足）；无 Windows 版 Rust 二进制（服务端 Linux 专属）  
**Scale/Scope**: 新增 `src/seek-preview/` crate + C# 2 个新文件 + TypeScript 2 个文件修改 + 构建基础设施更新

## Constitution Check

constitution.md 为空模板，无具体 gates。遵循项目现有约定：
- 不引入新 npm 依赖 ✅
- TypeScript / C# 编译无错 ✅（构建验证）
- 不影响现有长按手势逻辑 ✅（新代码独立路径）
- seek-preview 无 Windows 二进制，非 Linux 环境静默降级 ✅

## Project Structure

### Documentation (this feature)

```text
specs/008-trickplay-seek-preview/
├── spec.md
├── plan.md              ← 本文件
├── research.md          ← Phase 0 输出
├── data-model.md        ← Phase 1 输出
└── tasks.md             ← Phase 2 输出
```

### Source Code — New Files

```text
src/seek-preview/
├── Cargo.toml           ← 新增：crate 配置
└── src/
    └── main.rs          ← 新增：完整 daemon 实现

src/JellyfinSuite.Plugin/
├── Services/
│   └── SeekPreviewService.cs    ← 新增：进程管理 + 双 socket 连接
└── Controllers/
    └── SeekPreviewController.cs ← 新增：HTTP 端点
```

### Source Code — Modified Files

```text
src/player-enhancer/src/
├── trickplay.ts         ← 重写：移除 sprite sheet 逻辑，改为 HTTP 请求 seek-preview 端点
└── long-press.ts        ← 修改：seekIdleTimer 触发 FETCH；水平拖动分支追加速度检测与预取

src/JellyfinSuite.Plugin/
└── PluginServiceRegistrator.cs  ← 修改：注册 SeekPreviewService 单例

Makefile                         ← 修改：新增 build-seek-preview；test-rust + update 追加
.github/workflows/build.yml      ← 修改：ffmpeg dev libs + seek-preview cargo test
.github/workflows/release.yml    ← 修改：build seek-preview + zip 包含二进制
```

---

## Architecture

### 整体数据流

```
触控横滑（减速 velPxPerMs < 8）
  → prefetchFrame(predicted±500ms)
      → GET /JellyfinSuite/SeekPreview/{id}?positionMs=N&prefetch=true&api_key=TOKEN
          （fire-and-forget，PREFETCH 连接）
          → Rust: 后台解码，存入 LruCache

seekIdleTimer 150ms 触发
  → showTrickplayThumb(currentTime*1000, itemId)
      → <img>.src = ".../SeekPreview/{id}?positionMs=N&api_key=TOKEN"
          → GET（FETCH 连接，await JPEG）
          → Rust: LruCache hit → <1ms；miss → decode ~50ms
          → image/jpeg → img.src 更新 → 缩略图显示

手指离开（touchend / updateOsd(0)）
  → hideTrickplayThumb()  →  _thumbEl 移除
```

### Rust Daemon 内部结构

```
UnixListener（path: DataPath/jfs-seek-preview.sock）
  └── 每个连接 spawn tokio task → 解析请求帧 → 分发到对应 channel

SharedState（Arc）
  ├── Mutex<LruCache<(PathBuf, i64), Arc<Vec<u8>>>>  // i64 = pos_ms/500*500，50 条上限
  └── Mutex<AvContextPool>  // 保留最近 2 个文件的 AVFormatContext + Decoder

优先队列（两个 mpsc channel）
  ├── fetch_tx/fetch_rx    // FETCH (priority=0x01)
  └── prefetch_tx/prefetch_rx  // PREFETCH (priority=0x02)

Worker 线程（num_cpus::get() 个，spawn_blocking）
  → 优先消费 fetch_rx → 空时消费 prefetch_rx
  → get_or_open(path) → seek_and_decode(pos_ms) → scale_and_encode(width)
  → 写 LruCache → 写响应帧
```

### 二进制协议（Unix socket）

```
Request（C# → Rust）：
  [1 byte]  priority: 0x01=FETCH, 0x02=PREFETCH
  [4 bytes] request_id (u32 LE)
  [8 bytes] pos_ms (i64 LE)
  [4 bytes] width (i32 LE)
  [4 bytes] path_len (u32 LE)
  [N bytes] file path (UTF-8)

Response（Rust → C#）：
  [4 bytes] request_id (u32 LE)
  [4 bytes] jpeg_len (u32 LE)  — 0 = PREFETCH ACK 或失败
  [N bytes] JPEG data
```

### C# 并发控制

SeekPreviewService 维持**两条独立 socket 连接**，彻底避免 PREFETCH 阻塞 FETCH：

| 连接 | 用途 | 控制方式 |
|------|------|----------|
| FETCH 连接 | 获取 JPEG，需 await 响应 | `SemaphoreSlim(1,1)` 串行化写入 |
| PREFETCH 连接 | 触发后台解码，不等响应 | fire-and-forget，ACK 直接丢弃 |

---

## Phase 0: Research

已完成，详见 [research.md](research.md)。关键决策摘要：

| 决策 | 结论 |
|------|------|
| 帧提取方案 | ffmpeg-next crate（内存解码，无临时文件，≤50ms） |
| IPC 方案 | Unix domain socket（双向异步，支持并发 FETCH+PREFETCH） |
| 并发模型 | 两条独立 C# socket 连接，优先队列在 Rust 侧 |
| 预取策略 | 速度外推（velPxPerMs < 8 → 预取 ±500ms 三点） |
| 缓存策略 | Rust LruCache 50 条，key 对齐 500ms，命中后 <1ms |
| socket 路径 | `DataPath/jfs-seek-preview.sock`（避免 /tmp 多实例冲突） |
| 多核加速 | `thread_type = Slice, thread_count = num_cpus.min(4)` ，约提速 20% |

---

## Phase 1: Design

### 1. trickplay.ts — 重写设计

新架构下 `trickplay.ts` 不再处理 sprite sheet，只封装 seek-preview HTTP 端点调用：

```typescript
interface SeekPreviewMeta {
  base: string;   // Jellyfin server address
  token: string;  // API token
}

const _cache = new Map<string, SeekPreviewMeta>();
let _thumbEl: HTMLImageElement | null = null;

export async function initTrickplay(itemId: string, _videoEl: HTMLVideoElement): Promise<void> {
  if (_cache.has(itemId)) return;
  _cache.set(itemId, { base: getServerAddress(), token: getRawToken() });
}

export function showTrickplayThumb(posMs: number, itemId: string): void {
  const meta = _cache.get(itemId);
  if (!meta) return;
  if (!_thumbEl) {
    _thumbEl = document.createElement('img');
    _thumbEl.className = 'jfs-speed-osd__thumb';
    // FR-008: maxW/maxH 约束由 JS 动态计算（见 styles.ts 注释）
    document.body.appendChild(_thumbEl);
  }
  _thumbEl.src = `${meta.base}/JellyfinSuite/SeekPreview/${itemId}?positionMs=${posMs}&api_key=${meta.token}`;
}

export function prefetchFrame(posMs: number, itemId: string): void {
  const meta = _cache.get(itemId);
  if (!meta) return;
  void fetch(`${meta.base}/JellyfinSuite/SeekPreview/${itemId}?positionMs=${posMs}&prefetch=true&api_key=${meta.token}`);
}

export function hideTrickplayThumb(): void {
  _thumbEl?.remove();
  _thumbEl = null;
}
```

缩略图 `<img>` 尺寸约束（FR-008）：`showTrickplayThumb` 调用时根据 `video.getBoundingClientRect()` 计算 `maxW = min(window.innerWidth * 0.45, playerRect.width * 0.50)`、`maxH = min(window.innerHeight * 0.40, playerRect.height * 0.40)`，以 `style.maxWidth` / `style.maxHeight` 应用；`object-fit: contain; background: #000` 保持比例并填充竖向视频两侧空白。

### 2. long-press.ts — 修改点

#### seekIdleTimer 触发 FETCH（复用现有 150ms idle timer）

```typescript
seekIdleTimer = setTimeout(() => {
  seekIdleTimer = null;
  if (_active) {
    video.playbackRate = getRate();
    showTrickplayThumb(video.currentTime * 1000, itemId);  // ← 新增
  }
}, 150);
```

#### 水平拖动分支追加速度检测与预取

```typescript
// 现有 deltaX 计算之后追加：
const now = performance.now();
const dt = now - _lastMoveTime;
_lastMoveTime = now;
if (dt > 0) {
  const velPxPerMs = Math.abs(deltaX) / dt;
  if (velPxPerMs < 8 && seekAnchorTime >= 0) {
    const predictedMs = video.currentTime * 1000 + velPxPerMs * 150;
    prefetchFrame(Math.max(0, predictedMs - 500), itemId);
    prefetchFrame(Math.max(0, predictedMs), itemId);
    prefetchFrame(Math.max(0, predictedMs + 500), itemId);
  }
}
```

#### hideTrickplayThumb 调用时机

- `updateOsd(0)` 时（seekOffset 为 0，显示"← → 提示"）
- 竖向移动重置 `seekAnchorTime` 时
- `exit()` → `hideOsd()` 时

### 3. SeekPreviewService.cs — 设计

```csharp
public sealed class SeekPreviewService : IDisposable
{
    private Process? _process;
    private Socket? _fetchSocket;    // FETCH 专用连接（SemaphoreSlim(1,1) 保护）
    private Socket? _prefetchSocket; // PREFETCH 专用连接（fire-and-forget）
    private readonly SemaphoreSlim _fetchLock = new(1, 1);
    private readonly string _socketPath;   // DataPath/jfs-seek-preview.sock
    private readonly string _binaryPath;  // PluginsPath/JellyfinSuite/seek-preview-linux-x64

    // 启动进程 + 建立两条 socket 连接；进程退出时 Task.Run 自动重启
    public Task StartAsync(CancellationToken ct);

    // FETCH 连接：发 FETCH 请求，await JPEG 响应，返回 byte[]
    public Task<byte[]?> FetchAsync(string filePath, long posMs, int width, CancellationToken ct);

    // PREFETCH 连接：fire-and-forget，不阻塞调用方
    public void Prefetch(string filePath, long posMs, int width);
}
```

### 4. SeekPreviewController.cs — 端点设计

```
GET /JellyfinSuite/SeekPreview/{itemId}
    ?positionMs={ms}
    [&prefetch=true]
    [&api_key={token}]
```

- `prefetch=true`：调 `_service.Prefetch(...)` → 200 空体（立即返回，Rust 后台解码）
- 否则：`await _service.FetchAsync(...)` → `File(bytes, "image/jpeg")`
- itemId 不存在 / 无本地文件路径 → 404
- Rust 进程未启动 / socket 连接失败 → 503

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/seek-preview/Cargo.toml` | 新增 | crate 配置，tokio/ffmpeg-next/lru/num_cpus/anyhow |
| `src/seek-preview/src/main.rs` | 新增 | 完整 daemon：socket 服务、优先队列、LruCache、ffmpeg-next 解码 |
| `src/JellyfinSuite.Plugin/Services/SeekPreviewService.cs` | 新增 | 进程管理 + 双 socket 连接协议 |
| `src/JellyfinSuite.Plugin/Controllers/SeekPreviewController.cs` | 新增 | HTTP 端点 |
| `src/JellyfinSuite.Plugin/PluginServiceRegistrator.cs` | 修改 | 注册 SeekPreviewService 单例 |
| `src/player-enhancer/src/trickplay.ts` | 重写 | 移除 sprite sheet，改为 HTTP 请求 seek-preview 端点 |
| `src/player-enhancer/src/long-press.ts` | 修改 | seekIdleTimer FETCH + velocity prefetch |
| `Makefile` | 修改 | build-seek-preview target；test-rust/update 追加 seek-preview |
| `.github/workflows/build.yml` | 修改 | ffmpeg dev libs 安装 + seek-preview cargo test |
| `.github/workflows/release.yml` | 修改 | seek-preview Linux 二进制构建 + zip 打包 |
