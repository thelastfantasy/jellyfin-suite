# Feature Specification: Rust 渲染引擎重构——双锚点布局系统 + 数据驱动主题 + 动画前置接口

**Feature Branch**: `004-rust-layout-engine`  
**Created**: 2026-05-17  
**Status**: Draft  

## 背景与动机

截图墙生成器的 Rust 渲染引擎当前存在三个可扩展性瓶颈：

1. **坐标硬编码**：文字、时间戳、品牌图标等元素的位置以 magic number 分散在多个源文件中，任何布局调整都需要修改多处代码并重新验证像素偏移。
2. **主题以 match 分支实现**：新增主题需要在渲染逻辑中添加分支，新增元素需要同步修改所有主题分支，扩展成本高且容易遗漏。
3. **无动画层级概念**：现有管线不区分"一次性渲染层"和"逐帧重绘层"，未来添加动图主题时需要大规模重构。

本次重构建立统一的布局与层级模型，使主题成为可独立定义的数据，为后续动画能力奠定基础。

---

## User Scenarios & Testing

### User Story 1 — 主题开发者：无需改动渲染代码即可新增主题 (Priority: P1)

主题开发者（当前项目维护者或未来贡献者）希望添加一个全新视觉主题，只需定义颜色、元素布局和层级，而不必阅读或修改任何渲染函数的实现。

**Why this priority**: 这是本次重构最核心的价值——解耦主题定义与渲染逻辑，是其他用户故事的前提。

**Independent Test**: 在不修改任何现有渲染函数的前提下，仅通过新增一个 Theme 构造函数，即可使新主题出现在 `--color-theme` 的可选列表中，并生成视觉正确的截图墙。

**Acceptance Scenarios**:

1. **Given** 现有 5 个主题全部已迁移到 Theme 数据结构，**When** 开发者新增第 6 个主题（仅新增构造函数，不修改渲染代码），**Then** 该主题可通过 `--color-theme <id>` 正常生成图片，所有视觉元素正确渲染。
2. **Given** 当前 cinematic 主题通过 match 分支实现，**When** 迁移完成后，**Then** 相同参数下生成的图片与迁移前像素级一致（通过现有图像测试验证）。
3. **Given** 用户指定不存在的主题 id，**When** 运行生成命令，**Then** 返回明确错误信息并列出所有可用主题 id。

---

### User Story 2 — 布局维护者：用锚点描述元素位置，无需计算像素坐标 (Priority: P1)

开发者需要调整任意视觉元素（品牌文字、视频信息块、时间戳徽章、二维码）的位置时，通过声明"该元素的哪个角对齐到哪个区域的哪个角，再偏移多少像素"来表达意图，系统自动计算实际像素坐标。

**Why this priority**: 与 P1 并列——双锚点定位是数据驱动主题的核心机制，没有它，主题数据无法描述元素位置。

**Independent Test**: 将时间戳徽章从"单元格左下角"改为"单元格右下角"，只需修改两个 anchor 字段值，无需计算任何坐标，重新生成后徽章位置正确。

**Acceptance Scenarios**:

1. **Given** 某主题将品牌文字定位为"Header 区域右上角，内缩 8px"，**When** 调整 Header 高度，**Then** 品牌文字自动跟随 Header 边界，无需手动更新坐标。
2. **Given** 时间戳徽章 `parent_anchor = BotLeft`、`self_anchor = BotLeft`，**When** 任意调整单元格大小，**Then** 徽章始终贴合单元格左下角，内边距维持设定值。
3. **Given** 同一区域内有多个元素设置了 margin，**When** 计算布局，**Then** 元素间距反映各自的 margin 设定，不发生重叠（margin 影响元素起始位置，不自动 reflow）。

---

### User Story 3 — Z-order 层级控制：元素遮挡关系由数据决定 (Priority: P2)

视觉元素的渲染顺序（谁遮挡谁）由每个元素的 `z_order` 整数值统一控制，数值大的元素渲染在上方，与元素类型无关。

**Why this priority**: z_order 系统是动画前置接口的基础——动态效果层必须能插入正确的层级位置。

**Independent Test**: 将二维码的 z_order 设为低于背景图层的值，生成图片后二维码被背景遮盖；将其恢复为高值，二维码正常显示在前景。

**Acceptance Scenarios**:

1. **Given** 背景大图（z_order=10）与品牌文字（z_order=40）同时存在，**When** 渲染，**Then** 品牌文字始终显示在背景图之上。
2. **Given** 两个元素 z_order 相同，**When** 渲染，**Then** 后定义的元素渲染在上方（稳定排序，定义顺序决定平局）。
3. **Given** 新增一个 z_order=25 的 Effect 占位层，**When** 渲染静态主题，**Then** 该层被跳过（不影响输出），其他层的视觉效果与未添加时一致。

---

### User Story 4 — 动画前置接口：主题可声明动画意图，004 阶段不渲染 (Priority: P3)

主题数据结构支持携带动画规格（帧率、循环时长、效果列表），但 004 阶段不实现实际的逐帧渲染。当主题携带动画规格时，系统返回明确的"尚未实现"提示，不产生静默失败或错误的输出文件。

**Why this priority**: 接口预留是低成本的前置工作，确保未来动画实现不需要重新设计数据结构；但渲染实装属于后续阶段，不应占据本次重构的主要工作量。

**Independent Test**: 定义一个携带 `AnimationSpec` 的测试主题，通过 `--color-theme <id>` 调用，系统输出明确错误 `animation not yet implemented for theme '<id>'`，退出码非零，不生成任何输出文件。

**Acceptance Scenarios**:

1. **Given** 某主题 `animation: Some(AnimationSpec { fps: 15, loop_secs: 4.0, effects: [...] })`，**When** 以该主题生成截图墙，**Then** 进程以非零退出码退出，stderr 输出 `animation not yet implemented`，不写入输出文件。
2. **Given** 某主题 `animation: None`，**When** 以该主题生成截图墙，**Then** 行为与重构前完全一致，输出静态 WebP 文件。
3. **Given** `EffectSpec` 枚举包含 `LightStreak`、`Meteor`、`GlowPulse` 变体并定义了完整字段，**When** 编译，**Then** 编译通过无错误（`#[allow(dead_code)]` 标注允许未使用字段）。

---

### Edge Cases

- 主题注册表中没有任何主题时，启动时 panic 并提示"no themes registered"（开发期快速失败）。
- `Placement` 中 `parent_anchor` 和 `self_anchor` 均为 Center，且 offset 为 (0,0) 时，元素精确居中于父区域，padding 正常生效。
- 元素经过 Placement 计算后超出父区域边界时，裁剪到父区域边界（不 panic，不静默溢出）。
- `Cell(col, row)` 的 col/row 超出网格范围时，LayoutContext 查找返回 Err 而非 panic。
- 所有现有 Rust 单元测试在重构完成后全部通过，不允许因重构删除测试用例。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供 9 方位锚点枚举（TopLeft/TopCenter/TopRight/MidLeft/Center/MidRight/BotLeft/BotCenter/BotRight），用于描述矩形区域上的参考点。
- **FR-002**: 系统 MUST 支持双锚点定位结构，包含：父区域(RegionId)、父锚点(Anchor9)、自身锚点(Anchor9)、像素偏移(f32,f32)、内边距(Insets)、外边距(Insets)。
- **FR-003**: 系统 MUST 定义区域枚举（Canvas/Header/Grid/Cell(u32,u32)/QrStrip），作为 Placement 的父区域参考。
- **FR-004**: 系统 MUST 提供 LayoutContext，在渲染前根据网格参数（rows/cols/cell_w/cell_h/header_h 等）预计算所有区域的像素矩形，供 Placement 解析使用。
- **FR-005**: 系统 MUST 将所有视觉元素的渲染顺序统一由 `z_order: i32` 字段控制，渲染管线按 z_order 升序绘制所有层。
- **FR-006**: 系统 MUST 将主题表示为数据值（Theme），包含：id(&str)、颜色组(ThemeColors)、层列表(Vec\<Layer\>)、可选动画规格(Option\<AnimationSpec\>)。
- **FR-007**: 系统 MUST 将现有 5 个主题全部迁移为 Theme 值，废弃所有 `match color_theme` 分支；迁移后在相同 CLI 参数下生成图像与迁移前视觉一致。
- **FR-008**: 系统 MUST 提供主题注册表（ThemeRegistry），通过主题 id 查找 Theme，`--color-theme` 参数解析使用注册表而非硬编码 match。
- **FR-009**: 系统 MUST 定义 Layer 类型，包含 z_order(i32)、placement(Placement)、kind(LayerKind)。
- **FR-010**: LayerKind 枚举 MUST 包含：SolidFill、BackgroundImage、TextBlock(TextSpec)、QrCode、CellThumbnail { col, row }、TimestampBadge { col, row }、Effect(EffectSpec)（动画占位）。
- **FR-011**: 系统 MUST 定义 AnimationSpec { fps: u32, loop_secs: f32, effects: Vec\<EffectSpec\> } 和 EffectSpec 枚举（含 LightStreak/Meteor/GlowPulse 变体及完整字段），004 阶段 MUST NOT 实现逐帧渲染函数。
- **FR-012**: 携带 AnimationSpec 的主题被调用时，MUST 以非零退出码退出并向 stderr 输出 `animation not yet implemented for theme '<id>'`，不写入任何输出文件。
- **FR-013**: 重构后所有现有 `cargo test` 测试用例 MUST 全部通过，测试数量不得减少。
- **FR-014**: 新增公开类型（Anchor9/Placement/RegionId/Layer/Theme 等）MUST 附有 Rust doc 注释，说明用途和字段含义。

### Key Entities

- **Anchor9**：9 方位枚举，表示矩形区域上的参考点。
- **Insets**：四边边距描述（top/right/bottom/left，单位 px，f32）。
- **Placement**：定位描述符（parent: RegionId, parent_anchor: Anchor9, self_anchor: Anchor9, offset: (f32,f32), padding: Insets, margin: Insets）。
- **RegionId**：父区域枚举（Canvas/Header/Grid/Cell(u32,u32)/QrStrip）。
- **Region**：像素矩形（x: u32, y: u32, w: u32, h: u32）。
- **LayoutContext**：预计算的区域映射，提供 `region(id: RegionId) -> Result<Region>` 查找。
- **Layer**：单个视觉层（z_order: i32, placement: Placement, kind: LayerKind）。
- **LayerKind**：层内容枚举，区分静态内容类型与动画占位。
- **ThemeColors**：颜色组（canvas_bg/header_bg/text_primary/text_secondary/accent/timestamp_bg/timestamp_text，均为 [u8;4] RGBA）。
- **Theme**：主题数据值（id: &str, colors: ThemeColors, layers: Vec\<Layer\>, animation: Option\<AnimationSpec\>）。
- **ThemeRegistry**：主题集合，提供 `get(id: &str) -> Option<&Theme>` 和 `ids() -> Vec<&str>` 接口。
- **AnimationSpec**：动画规格（fps: u32, loop_secs: f32, effects: Vec\<EffectSpec\>），004 仅作类型定义。
- **EffectSpec**：效果枚举（LightStreak { angle_deg, width_frac, speed, color, count, z_order } / Meteor { spawn_edge, angle_deg, length, color, per_loop, z_order } / GlowPulse { target, color, pulse_hz, radius, z_order }），004 仅作字段定义。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 新增第 6 个主题的改动 MUST 仅涉及新增 Theme 构造函数所在文件，渲染函数文件（image_stitcher.rs/text_renderer.rs）的 diff 为空——可通过 `git diff` 验证。
- **SC-002**: 5 个已迁移主题在相同 CLI 参数下生成的图像，通过现有 Rust 测试验证视觉一致性（像素级相同，或差异有明确记录）。
- **SC-003**: `cargo test` 在重构完成后全部通过，通过测试数量 ≥ 重构前数量。
- **SC-004**: 调整任意元素的定位（如时间戳位置从左下改为右下），涉及代码改动 ≤ 5 行。
- **SC-005**: 携带 AnimationSpec 的主题调用后，退出码 ≠ 0，stderr 含 `animation not yet implemented`，输出目录无新文件。

---

## Assumptions

- 本次重构的主要范围是 `src/poster-gen/` Rust 二进制；C# 后端和前端仅在 CLI 参数名称或主题 id 列表发生变更时做最小适配（预计无需改动）。
- 现有 5 个主题的视觉设计（颜色、布局比例）在迁移后保持不变；本次不修改任何主题的视觉呈现。
- 重构以保持现有 CLI 参数兼容为前提；`--color-theme` 的有效值集合不缩减。
- 动画渲染（AnimatedWebP 编码、逐帧 Effect 绘制）属于后续独立阶段（005+），不纳入本次交付。
- 新建模块（layout.rs、layer.rs）使用标准 Rust 模块系统，004 阶段不引入任何新的外部 crate 依赖。
- margin 的语义仅影响元素的起始位置偏移，不触发自动 reflow（非 CSS Flexbox 语义）。
