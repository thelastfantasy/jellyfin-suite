# Feature Specification: Trickplay Seek Preview

**Feature Branch**: `feat/trickplay-seek-preview`  
**Created**: 2026-05-22  
**Status**: Draft  
**Input**: User description: "008 trickplay-seek-thumbnail"

## Clarifications

### Session 2026-05-22

- Q: 触发时机是拖动原生进度条，还是长按加速手势的横滑 seek（spec 007）？ → A: 长按加速手势横滑 seek（spec 007），与原生进度条无关
- Q: 全屏模式下是否显示？ → A: 显示；功能本身与全屏/非全屏无关，手势在全屏下使用
- Q: 缩略图与速度 OSD 的整合方式，以及 OSD 位置和缩略图尺寸？ → A: 缩略图内嵌在速度 OSD 容器内（OSD 高度动态扩展）；OSD 垂直位置改为屏幕中央；缩略图尺寸需综合考虑屏幕尺寸、播放器尺寸、视频实际长宽比（含竖向视频）
- Q: 缩略图尺寸计算基准（单一基准 vs 多标准）？ → A: 多标准动态调节——同时参考 viewport 尺寸、播放器 bounding rect、视频实际长宽比，取所有约束的交集计算最优显示尺寸
- Q: 竖向视频高度受限时缩略图如何处理宽度不足？ → A: 对缩略图容器加左右填充（黑边或白边），保持容器宽度不变，竖向帧居中显示于容器内

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 横滑 seek 时显示目标帧预览 (Priority: P1)

用户在执行长按加速横滑 seek 手势（spec 007）时，速度 OSD 下方实时显示目标时间点对应的视频帧缩略图，帮助用户在释放前确认落点画面。

**Why this priority**: 这是本功能的全部价值。现有长按 seek 手势的 OSD 只显示时间偏移量（如 "+1m 23s"），用户仍需凭记忆猜测画面内容；加入帧预览后，用户可以精确定位目标场景，减少反复 seek 的次数。

**Independent Test**: 对已生成帧预览数据的视频执行长按横滑 seek，速度 OSD 下方出现缩略图并随横滑实时更新；释放后缩略图消失。单独验证此场景即可确认核心功能可用。

**Acceptance Scenarios**:

1. **Given** 视频拥有帧预览数据，且用户正处于长按加速横滑 seek 状态，**When** 产生非零 seekOffset，**Then** 速度 OSD 下方出现缩略图预览框，显示目标时间点（currentTime + seekOffset）对应的视频帧
2. **Given** 用户正在横滑并累积 seekOffset，**When** seekOffset 变化，**Then** 缩略图实时更新为新目标时间点的帧，无明显延迟
3. **Given** 用户释放手指（长按手势结束），**Then** 缩略图预览框平滑消失
4. **Given** 目标时间点超出视频范围（< 0 或 > duration），**Then** 显示边界处的帧（开头或结尾帧），不崩溃
5. **Given** 视频为竖向（如手机拍摄的 9:16 视频），**When** 横滑 seek，**Then** 缩略图按竖向比例显示，高度受限于屏幕可用空间，OSD 整体不超出视口

---

### User Story 2 - 无帧预览数据时降级处理 (Priority: P1)

当服务端未为该视频生成帧预览数据时，长按横滑 seek 手势的行为与无本功能时完全一致，速度 OSD 正常显示，无任何异常。

**Why this priority**: 降级是功能健壮性基线。帧预览数据在 Jellyfin 中属于可选生成项，未生成时应完全透明。

**Independent Test**: 对无帧预览数据的视频执行长按横滑 seek，速度 OSD 正常显示时间偏移，无缩略图出现，无控制台报错。

**Acceptance Scenarios**:

1. **Given** 视频无帧预览数据（服务端返回空结果），**When** 用户执行长按横滑 seek，**Then** 不出现缩略图预览框，速度 OSD 正常工作
2. **Given** 帧预览数据请求失败（网络异常、鉴权问题等），**Then** 静默降级，功能不影响手势本身的 seek 行为

---

### Edge Cases

- 当视频时长极短（< 帧间隔）时，帧预览数据可能只有 1 帧——显示该唯一帧，不崩溃
- 当用户极快速地左右来回横滑时，预览框应跟上最新 seekOffset，不因前一图集加载未完成而显示过期帧
- seekOffset 为 0（刚进入加速状态尚未横滑）时，不显示缩略图（与现有 OSD 行为一致：此时显示"← → 调节进度"提示而非偏移量）
- 竖向视频缩略图高度极大时（如 9:16 视频在高分辨率屏幕上），需设置高度上限（如不超过屏幕高度的 40%），宽度等比缩放
- 播放器被页面布局压缩（非全屏小窗模式）时，缩略图参考播放器 bounding rect 而非 viewport 来计算最大尺寸
- 极端竖向视频（如 1:3 超长竖屏）缩略图高度受限后可能极窄——此时左右填充比例远大于帧本身，仍需保持整体美观不变形

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 在长按加速横滑 seek 手势产生非零 seekOffset 期间，系统 MUST 在速度 OSD 内嵌显示目标时间点对应的帧缩略图（OSD 高度随缩略图动态扩展）
- **FR-002**: 缩略图 MUST 对应 `currentTime + seekOffset` 经边界 clamp 后的时间点（与速度 OSD 显示的目标时间一致）
- **FR-003**: 手势结束（手指释放）后，缩略图 MUST 随速度 OSD 一同消失（允许淡出动画）
- **FR-004**: seekOffset 为 0 时，MUST 不显示缩略图（与速度 OSD 的"← → 提示"状态对应）
- **FR-005**: 若视频无帧预览数据或获取失败，MUST 不影响长按横滑 seek 手势的任何现有行为
- **FR-006**: 每个（文件路径, 时间点）组合 MUST 至多解码一次，结果存入 Rust daemon 内存 LruCache（上限 50 条，key 对齐到 500ms）；后续相同请求直接命中缓存，不重复解码
- **FR-007**: 速度 OSD 的垂直位置 MUST 改为屏幕垂直居中（不再固定在 top 15%）
- **FR-008**: 缩略图显示尺寸 MUST 通过多标准动态计算得出，同时满足以下所有约束，取最严者为准：
  - 不超过 viewport 宽高的合理比例（避免在小屏设备上过大）
  - 不超过播放器（video 元素 bounding rect）宽高的合理比例（适配全屏与小窗）
  - 保持视频的实际长宽比（从帧预览图集实际像素尺寸推算，不强制 16:9）
- **FR-009**: 竖向视频（高 > 宽）的缩略图 MUST 优先以高度为约束等比缩放；缩略图容器宽度保持与横向视频一致，竖向帧居中显示，左右空白区域以纯色填充（黑边或白边，规划阶段定色）

### Key Entities

- **SeekPreview Daemon（Rust 进程）**: 长驻后台的 Rust 二进制，通过 Unix domain socket 接收帧请求，用 ffmpeg-next crate 内存解码视频帧并以 JPEG 返回；内置 LruCache 避免重复解码，内置优先队列使 FETCH 优先于 PREFETCH
- **SeekPreview Endpoint（C# 服务）**: 插件暴露的 HTTP 端点（`GET /JellyfinSuite/SeekPreview/{itemId}`），接收前端请求后通过 Unix socket 转发给 Rust daemon，将 JPEG 字节流返回前端；`prefetch=true` 时 fire-and-forget 不阻塞响应
- **缩略图预览框（Thumbnail Preview）**: 附属于速度 OSD 的 `<img>` 元素，`src` 指向 SeekPreview Endpoint；不单独显示时间（目标时间已由速度 OSD 第二行展示）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 横滑停顿 150ms 后（seekIdleTimer 触发），缓存命中时缩略图在 10ms 内出现；缓存未命中时在 120ms 内出现（含 Rust 端关键帧解码 ~50ms + 网络往返 ~20ms）
- **SC-002**: 缩略图对应 seek 目标时间点的最近关键帧，帧误差在 0–4s 范围内（取决于视频 GOP 结构），不存在跨场景显示错误帧的情况
- **SC-003**: 在已有帧预览数据的视频上，100% 的长按横滑 seek 操作（seekOffset ≠ 0）可触发缩略图显示
- **SC-004**: 在无帧预览数据的视频上，长按横滑 seek 行为与无本功能时 100% 一致
- **SC-005**: 缩略图加载不影响横滑 seek 的手势响应速度（seekOffset 累积逻辑延迟增量 < 5ms）

## Assumptions

- seek-preview Rust daemon 部署为服务端 Linux 二进制（与 poster-gen 同路径），无 Windows 版本；Windows/非 Linux 环境下本功能静默降级
- Rust daemon 通过 ffmpeg-next crate 实时解码视频帧，无需 Jellyfin 开启 Trickplay 生成功能；视频文件需存在于 Jellyfin 服务器本地文件系统（远程 URL / IPTV 流不支持，返回 404 降级）
- 本功能仅针对视频内容（含剧集、电影），不适用于音乐/音频
- 缩略图长宽比由 ffmpeg 解码所得帧实际尺寸决定，不强制 16:9；竖向视频按实际比例显示，容器黑色填充两侧空白
- OSD 垂直居中定位取代原 top:15%（此改动同步影响 spec 007 的速度 OSD 样式）
- 缩略图预览框不显示时间文字（目标时间已由速度 OSD 的第二行展示）
- 本版本不做桌面端鼠标 seek 支持（该手势本身就是移动端专属）
