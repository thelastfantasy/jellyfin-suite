# Tasks: Trickplay Seek Preview — Custom High-Frequency API

**Input**: Design documents from `specs/008-trickplay-seek-preview/`  
**Branch**: `fix/issue-43-bugs`  
**Prerequisites**: spec.md ✅ plan.md ✅ research.md ✅ data-model.md ✅

## 架构概要

```
前端 trickplay.ts
  ├── 减速阶段（velocity < 8px/ms）→ prefetch ?prefetch=true（fire-and-forget）
  └── seekIdleTimer 150ms → FETCH 返回 JPEG → img.src 更新

C# SeekPreviewController / SeekPreviewService
  ├── FETCH  → Unix socket → Rust → cache hit (<1ms) 或 decode (~50ms) → JPEG
  └── PREFETCH → Unix socket → Rust → 后台 decode → cache → 200 OK

Rust seek-preview daemon（tokio + ffmpeg-next）
  ├── Unix socket 监听 /tmp/jfs-seek-preview.sock
  ├── 优先队列：FETCH task 优先于 PREFETCH task
  ├── Arc<Mutex<LruCache<(path, pos/500), Vec<u8>>>>  ← JPEG cache（上限 50 条）
  ├── Arc<Mutex<AvContextPool>>  ← 保持最近 2 个文件的 AVFormatContext
  └── spawn_blocking 线程池（num_cpus 核数，slice threading）
```

---

## 已完成（原生 Trickplay 基础显示）

- [x] T001 创建 `src/player-enhancer/src/trickplay.ts`，声明类型与模块级缓存
- [x] T002 实现 `getAuthHeader()` / `getRawToken()` / `getServerAddress()`
- [x] T003 实现 `computeFrame(positionMs, meta): FrameLocation`
- [x] T004 实现 `computeDisplaySize(...)` 多标准尺寸计算
- [x] T005 实现 `fetchMeta(itemId)` — 请求 `/Items/{id}` 解析 Trickplay 元数据
- [x] T006 实现 `initTrickplay(itemId, videoEl)` — 缓存 + 预热首张 sprite sheet
- [x] T007 实现 `showTrickplayThumb()` — body 级独立定位 + `?api_key=` 鉴权 + `translateX(-50%)`
- [x] T008 实现 `hideTrickplayThumb()` — 移除 body 级缩略图元素
- [x] T009 修改 `src/player-enhancer/src/styles.ts` — OSD 垂直居中；新增 `.jfs-speed-osd__thumb`
- [x] T010 修改 `src/player-enhancer/src/long-press.ts` — 集成 show/hideTrickplayThumb
- [x] T011 修改 `src/player-enhancer/src/injector.ts` — 传 itemId 给 initLongPress + initTrickplay

---

## Phase 1: Setup — crate 骨架 + 构建基础设施

**Purpose**: 建立 seek-preview crate 的项目骨架，打通 Makefile、CI workflow、打包流程。

- [x] T012 创建 `src/seek-preview/Cargo.toml`：package `seek-preview` edition 2021；依赖 `tokio`（features: full）、`ffmpeg-next`、`lru`、`anyhow`
- [x] T013 创建 `src/seek-preview/src/main.rs` 占位骨架（空 tokio::main，确认 `cargo check` 通过）
- [x] T014 [P] 更新 `Makefile`：
  - 新增 `build-seek-preview` target：Docker `rust:1.88-slim-bookworm` + `apt-get install -y pkg-config libavcodec-dev libavformat-dev libavutil-dev libswscale-dev` + `cargo build --release` + `cp` 到 `src/JellyfinSuite.Plugin/seek-preview-linux-x64`
  - `build` target 依赖追加 `build-seek-preview`
  - `update` target 追加 `docker cp seek-preview-linux-x64 jellyfin-dev:/config/plugins/JellyfinSuite/seek-preview-linux-x64`
  - `test-rust` target 追加 `cd src/seek-preview && cargo test`
- [x] T015 [P] 更新 `.github/workflows/build.yml`：
  - `Cache Rust build` 的 `workspaces` 追加 `src/seek-preview`
  - 在 `Setup .NET` 之前新增步骤 `Install ffmpeg dev libs`：`sudo apt-get install -y pkg-config libavcodec-dev libavformat-dev libavutil-dev libswscale-dev`
  - `test-rust` 步骤（即 `make test-rust`）已通过 T014 的 Makefile 更新自动覆盖 seek-preview 的 `cargo test`，无需额外添加 `cargo build --release`
- [x] T016 [P] 更新 `.github/workflows/release.yml`：
  - `Cache Rust build` 的 `workspaces` 追加 `src/seek-preview`
  - 在 cross 安装之前新增 `Install ffmpeg dev libs` 步骤（同上）
  - 新增步骤 `Build seek-preview (Linux x64)`：`cd src/seek-preview && cargo build --release`
  - `Copy poster-gen binaries to publish dir` 步骤追加：`cp src/seek-preview/target/release/seek-preview publish/seek-preview-linux-x64` + `chmod +x`
  - `Create release zips` 两个 zip 命令均追加 `seek-preview-linux-x64`（Linux-only，无 Windows 版）

**Checkpoint**: `make build-seek-preview` 产出二进制；CI build.yml 绿；release.yml zip 包含 `seek-preview-linux-x64`。

---

## Phase 2: Foundational — Rust daemon 实现

**Purpose**: 完整实现 Unix socket 服务、优先队列、缓存、解码流水线。

### 协议（Unix socket 上的二进制帧）

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

- [x] T017 在 `src/seek-preview/src/main.rs` 实现 Unix socket 服务端（`tokio::net::UnixListener`）；socket 路径由命令行参数传入；每个连接 spawn 独立 task；实现请求帧读取函数（按协议解析字节）
- [x] T018 在 `src/seek-preview/src/main.rs` 实现共享状态结构体：`Arc<State>` 包含 `Mutex<LruCache<CacheKey, Arc<Vec<u8>>>>` (50条上限)
- [x] T019 在 `src/seek-preview/src/main.rs` 实现优先分发：FETCH 分支等待 spawn_blocking 结果再响应；PREFETCH 分支立即 ACK 后 tokio::spawn 后台解码，优先级通过独立 socket 连接隔离
- [x] T020 在 `src/seek-preview/src/main.rs` 实现解码上下文管理：per-request 打开文件（cache hit 路径直接跳过解码，miss 路径 ffmpeg::format::input + slice threading）
- [x] T021 在 `src/seek-preview/src/main.rs` 实现 seek + decode：AV_TIME_BASE seek → decoder.flush() → packet/frame 循环直到 frame.pts() >= target_pts
- [x] T022 在 `src/seek-preview/src/main.rs` 实现 scale + encode：sws_scale (YUVJ420P) → MJPEG via raw FFI (avcodec_alloc_context3/send_frame/receive_packet)，quality = FF_QP2LAMBDA * 5
- [x] T023 在 `src/seek-preview/src/main.rs` 实现 fetch worker 逻辑：查 LruCache → hit → 直接写响应；miss → decode_and_encode → 存 cache → 写响应
- [x] T024 在 `src/seek-preview/src/main.rs` 实现 prefetch worker 逻辑：写 ACK（jpeg_len=0）→ 后台 decode → 存 cache

**Checkpoint**: 手动 `echo -ne "\x01\x00\x00\x00\x00\x28\x23\x00\x00\x00\x00\x00\x00\xa0\x00\x00\x00..." | nc -U /tmp/jfs-seek-preview.sock` 或用 socat 发请求，stdout 收到 JPEG magic `FF D8 FF`。

---

## Phase 3: User Story 1 — C# 端点

**Goal**: `GET /JellyfinSuite/SeekPreview/{itemId}?positionMs={ms}[&prefetch=true]`

**Independent Test**: `curl "http://localhost:8600/JellyfinSuite/SeekPreview/{itemId}?positionMs=5000"` 返回 `Content-Type: image/jpeg`；`?prefetch=true` 返回 200 空体。

- [x] T025 [US1] 新增 `src/JellyfinSuite.Plugin/Services/SeekPreviewService.cs`：单例服务，负责启动/保活 seek-preview 进程，维持两条 UnixDomainSocket 连接，进程退出时自动重连（3s 后）
- [x] T026 [US1] 在 `SeekPreviewService` 实现两条独立 socket 连接：`_fetchSocket`（FETCH 专用，`SemaphoreSlim(1,1)`）与 `_prefetchSocket`（PREFETCH 专用，fire-and-forget，_prefetchConnLock 防止并发写同一 socket）
- [x] T027 [US1] 在 `SeekPreviewService` 实现 `FetchAsync` / `Prefetch` — 二进制协议帧组装（BinaryPrimitives LE）+ `ReceiveBytesAsync` 精确读取
- [x] T028 [US1] 新增 `src/JellyfinSuite.Plugin/Controllers/SeekPreviewController.cs`：`[AllowAnonymous]`, `GET /JellyfinSuite/SeekPreview/{itemId}`，prefetch=true 返回 200，否则返回 image/jpeg
- [x] T029 [US1] 在 `src/JellyfinSuite.Plugin/PluginServiceRegistrator.cs` 注册 `SeekPreviewService` 为单例

**Checkpoint**: curl 测试通过；prefetch 端点不阻塞后续 fetch 请求。

---

## Phase 4: User Story 1 — 前端集成

**Goal**: 拖动减速时预取，停止时实时显示精确帧。

**Independent Test**: 拖动时 Network 面板看到 `?prefetch=true` 请求（无需等响应）；停顿 150ms 后看到正式 fetch 请求，缩略图立即更新。

- [x] T030 [P] [US1] 重写 `src/player-enhancer/src/trickplay.ts`：删除 sprite sheet 逻辑；`initTrickplay` 只缓存 `{ base, token }`；`showTrickplayThumb(posMs, itemId, videoEl)` 计算 FR-008 maxW/maxH 并赋值 img.src；`prefetchFrame` fire-and-forget；`hideTrickplayThumb` 移除元素
- [x] T031 [US1] 修改 `src/player-enhancer/src/long-press.ts`：seekIdleTimer 回调追加 `showTrickplayThumb`；竖向移动调 `hideTrickplayThumb()`；resuming drag 清 timer 时调 `hideTrickplayThumb()`；updateOsd(0) 时调 `hideTrickplayThumb()`
- [x] T032 [P] [US1] 在 `src/player-enhancer/src/long-press.ts` 追加 `lastMoveTime` + 速度检测（`velPxPerMs = |deltaX| / dt`）；`velPxPerMs < 8` 时预取 predictedMs ±500ms

**Checkpoint**: 编译通过；拖动减速时 Network 有 prefetch 请求；停顿后 img.src 更新。

---

## Phase 5: User Story 2 — 降级验证

- [ ] T033 [US2] 验证降级行为（手动）：（1）`SeekPreviewController` 对无本地路径的 itemId（远程流、IPTV 等）返回 404，不抛异常；（2）Rust 进程未启动时 C# 返回 503，前端 `<img>` 静默忽略加载失败，OSD 文字正常显示，无控制台报错

---

## Phase 6: Polish & 部署验证

- [ ] T035 运行 `mise run test`，确认 Rust + TypeScript + C# 全部通过
- [ ] T036 `make update` 部署到 jellyfin-dev，在触屏设备验证：
  - 减速阶段 Network 出现 prefetch 请求，停顿后缩略图立即更新（命中缓存时体感延迟 ≈ 150ms debounce）
  - 无本地路径视频：OSD 正常，无缩略图，无报错
  - 快速来回拖动：无崩溃、无旧帧残留
  - SC-005 验证：Chrome Performance profiler 录制横滑过程，确认 `touchmove` 事件处理函数耗时 < 5ms（prefetchFrame 为 fire-and-forget，不阻塞主线程）
- [ ] T037 检查 `README.md` / `README.zh-CN.md` 是否需要更新（新特性：高频 seek 预览）
- [ ] T038 提交 PR，标题：`feat: high-frequency seek preview via Rust daemon (#008)`

---

## Dependencies & Execution Order

```
Phase 1（T012–T016）— 无依赖，立即开始；T014/T015/T016 可并行
  ↓
Phase 2（T017–T024）— 依赖 T012/T013（crate 存在）；T017→T018→T019 顺序；T020–T022 可并行（不同函数）
  ↓
Phase 3（T025–T029）与 Phase 4（T030–T032）可并行（不同代码库）
  ↓
Phase 5（T033）— 依赖 Phase 3 + Phase 4
  ↓
Phase 6（T035–T038）
```

### Phase 1 内部并行

```
T012 → T013（骨架）
T014 [P]（Makefile）
T015 [P]（build.yml）
T016 [P]（release.yml）
```

### Phase 2 内部顺序

```
T017（socket server）
  → T018（共享状态）
  → T019（优先队列）
  → T020（AvContextPool）  ← T021（decode）← T022（scale+encode）
        ↓（T019–T022 完成后）
      T023（fetch worker）
      T024（prefetch worker）
```

### Phase 4 内部并行

```
T030 [P]（trickplay.ts 重写）
T031（long-press.ts idle timer 集成）
  ↓（T030 完成后）
T032 [P]（velocity 预取逻辑）
```

---

## Implementation Notes

- `seek-preview-linux-x64` 部署路径与 `poster-gen-linux-x64` 相同：`/config/plugins/JellyfinSuite/`；C# 用 `Path.Combine(_appPaths.PluginsPath, "JellyfinSuite", "seek-preview-linux-x64")` 定位
- seek-preview 无 Windows 版本（服务端二进制，Jellyfin 生产环境均为 Linux/Docker）
- Unix socket 路径 `/tmp/jfs-seek-preview.sock`；C# 侧 `new UnixDomainSocketEndPoint(path)` + `Socket(AddressFamily.Unix, ...)`，需 .NET 6+（Jellyfin 用 .NET 8，满足）
- ffmpeg-next 动态链接 libavcodec.so 等，Jellyfin Docker 镜像已含这些库，无需额外安装
- `AvContextPool` 保留最近 2 个文件的 context：fetch 和 prefetch 可能交替访问两个文件（如用户在列表里快速切换视频）
- LruCache key 的 pos 对齐到 500ms（`pos_ms / 500 * 500`）：C# 侧和 Rust 侧对齐一致，避免因取整方向不同导致 cache miss
