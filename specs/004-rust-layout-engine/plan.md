# Implementation Plan: Rust 渲染引擎重构——双锚点布局系统

**Branch**: `004-rust-layout-engine` | **Date**: 2026-05-17 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/004-rust-layout-engine/spec.md`

## Summary

将 `src/poster-gen/` Rust 二进制的渲染引擎从"硬编码坐标 + match 主题分支"重构为"双锚点定位 + 数据驱动 Theme 值 + Z-order 层级"。新增 `layout.rs`（几何/定位原语）和 `layer.rs`（层级/主题/动画类型），将现有 5 个主题全部迁移为 Theme 构造函数，废弃渲染函数中的 `match color_theme` 分支。

## Technical Context

**Language/Version**: Rust 2021 edition（与现有 `poster-gen` 一致）  
**Primary Dependencies**: 现有 crate 集合（image, ab_glyph, clap, rayon）；004 阶段不引入新 crate  
**Storage**: N/A（纯计算，读取视频帧 / 字体文件，输出 WebP）  
**Testing**: `cargo test`（当前 42 个测试用例，重构后数量不得减少）  
**Target Platform**: Linux 服务器容器（与现有部署一致）  
**Project Type**: CLI 二进制（poster-gen）  
**Performance Goals**: 与重构前相同——无性能回归；LayoutContext 预计算所有区域坐标，不在热路径动态查找  
**Constraints**: 不引入新 crate；TimestampPosition 枚举保留在 image_stitcher.rs（CLI 参数类型，非布局概念）；现有 CLI 参数名称全部保持不变

## Constitution Check

> 项目 constitution.md 为空模板，无强制约束。以下为 spec 层面的自查。

| Gate | Status | Notes |
|------|--------|-------|
| 所有现有测试通过（FR-013） | PENDING | 测试适配是 Phase 5 交付物 |
| 无新 crate 依赖（Assumptions） | ENFORCED | 实现时不得引入新 Cargo.toml 条目 |
| CLI 参数兼容（Assumptions） | ENFORCED | `--color-theme` 有效值集合不缩减 |
| 携带 AnimationSpec 的主题调用返回非零退出码（FR-012） | 设计保证 | layer.rs 的 Theme 类型携带 Option\<AnimationSpec\> |

## Project Structure

### Documentation (this feature)

```text
specs/004-rust-layout-engine/
├── plan.md              # 本文件
├── data-model.md        # 实体定义（Phase 1 输出）
└── tasks.md             # 任务拆解（/speckit-tasks 输出）
```

> research.md 和 quickstart.md 不需要——架构已在对话中完全决策；无外部 API contract（纯 Rust 内部重构）。

### Source Code（改动范围）

```text
src/poster-gen/src/
├── layout.rs            ← NEW  几何/定位原语
├── layer.rs             ← NEW  层级 / 主题 / 动画类型
├── text_renderer.rs     ← REFACTOR  使用 Placement 定位；get_theme() → 删除
├── image_stitcher.rs    ← REFACTOR  接受 &Theme 而非 color_theme: &str；GridLayout 保留
├── preview.rs           ← REFACTOR  同步 image_stitcher.rs 签名变更
└── main.rs              ← REFACTOR  ThemeRegistry 查找替代 match color_theme
```

```text
tests/JellyfinRecents.Tests/   （不改动）
src/JellyfinRecents.Plugin/    （不改动，除非主题 id 列表变更）
src/frontend/                  （不改动）
```

**Structure Decision**: 单一 Rust binary，仅在现有 `src/poster-gen/src/` 中增加两个模块文件。

---

## Architecture Design

### 模块职责划分

#### `layout.rs` — 几何与定位原语

```
Anchor9          9 方位枚举（TopLeft … BotRight + Center）
Insets           { top, right, bottom, left: f32 }
RegionId         Canvas | Header | Grid | Cell(u32, u32) | QrStrip
Region           { x: u32, y: u32, w: u32, h: u32 }
LayoutContext    预计算的 RegionId → Region 映射
  └─ fn compute(rows, cols, cell_w, cell_h, header_h, …) -> Self
  └─ fn region(&self, id: RegionId) -> Result<Region, LayoutError>
Placement        { parent: RegionId, parent_anchor: Anchor9,
                   self_anchor: Anchor9, offset: (f32,f32),
                   padding: Insets, margin: Insets }
```

**LayoutContext 与 GridLayout 的关系**：`GridLayout`（现有）负责行列间距 / 间隔计算，属 image_stitcher.rs 内部实现细节。`LayoutContext` 将基于 `GridLayout` 的计算结果构建完整的 `Region` 映射，供 `Placement` 解析使用。两者并存：GridLayout 不废弃，LayoutContext 封装其结果。

#### `layer.rs` — 层级、主题与动画类型

```
TextSpec         { text: String, font_size: u32, color: [u8;4] }
LayerKind        SolidFill { color: [u8;4] }
                 BackgroundImage
                 TextBlock(TextSpec)
                 QrCode
                 CellThumbnail { col: u32, row: u32 }
                 TimestampBadge { col: u32, row: u32 }
                 Effect(EffectSpec)   ← 动画占位，004 不渲染
Layer            { z_order: i32, placement: Placement, kind: LayerKind }
ThemeColors      { canvas_bg, header_bg, text_primary, text_secondary,
                   accent, timestamp_bg, timestamp_text,
                   qr_bubble_bg, qr_module, qr_finder_dark, qr_finder_light: [u8;4] }
Theme            { id: &'static str, colors: ThemeColors,
                   layers: Vec<Layer>, animation: Option<AnimationSpec> }
ThemeRegistry    { themes: Vec<Theme> }
  └─ fn get(&self, id: &str) -> Option<&Theme>
  └─ fn ids(&self) -> Vec<&str>
  └─ fn default_registry() -> Self   ← 注册 5 个内置主题
AnimationSpec    { fps: u32, loop_secs: f32, effects: Vec<EffectSpec> }
EffectSpec       LightStreak { angle_deg, width_frac, speed, color, count, z_order }
                 Meteor { spawn_edge, angle_deg, length, color, per_loop, z_order }
                 GlowPulse { target, color, pulse_hz, radius, z_order }
```

> `EffectSpec` 变体字段完整定义，编译通过，加 `#[allow(dead_code)]`；004 阶段不实现任何渲染函数。

### Z-order 预定义常量（layer.rs 公开）

| 常量 | 值 |
|------|----|
| `Z_CANVAS_BG` | 0 |
| `Z_BG_IMAGE` | 10 |
| `Z_CELL_THUMB` | 20 |
| `Z_EFFECT_BELOW` | 25 |
| `Z_HEADER_BG` | 30 |
| `Z_EFFECT_ABOVE` | 35 |
| `Z_TEXT_OVERLAY` | 40 |
| `Z_QR` | 40 |
| `Z_ICON` | 41 |
| `Z_TIMESTAMP` | 45 |

### `text_renderer.rs` 变更策略

- `ThemeColors` 结构体和 `get_theme(name: &str)` 函数**迁移**至 `layer.rs`（或保留声明在 text_renderer.rs、由 layer.rs re-export——按最小改动原则决定）
- `Renderer::new()` 签名改为接受 `&ThemeColors`（或 `&Theme`）替代 `color_theme: &str`
- 元素定位逻辑从硬编码像素偏移改为 `Placement::resolve(&layout_ctx)` 计算
- 现有 `get_theme()` 测试迁移为 `ThemeRegistry` 的测试

### `image_stitcher.rs` 变更策略

- `stitch()` 签名改为接受 `&Theme` 替代 `color_theme: &str`
- 渲染循环：按 `layer.z_order` 排序，对每个 `Layer` 调用对应的渲染函数
- `GridLayout` 保留不变，`LayoutContext::from_grid_layout(&gl)` 构建完整区域映射
- animation 检测：`if theme.animation.is_some() { return Err("animation not yet implemented for theme '{}'") }`

### `main.rs` 变更策略

- 启动时 `let registry = ThemeRegistry::default_registry()`
- `--color-theme` 解析：`registry.get(&args.color_theme).ok_or_else(|| { eprintln!("Unknown theme '{}'. Available: {}", …, registry.ids().join(", ")); … })`
- 将 `&theme` 传入 image_stitcher 和 text_renderer

---

## Phase Plan

### Phase 1：新建 layout.rs（几何原语）

- 新增 `src/poster-gen/src/layout.rs`
- 实现 `Anchor9`、`Insets`、`RegionId`、`Region`、`Placement`、`LayoutContext`
- 在 `main.rs` 添加 `mod layout;` 声明
- 全部公开类型附 Rust doc 注释（FR-014）
- 无需修改任何现有文件

### Phase 2：新建 layer.rs（主题与动画类型）

- 新增 `src/poster-gen/src/layer.rs`
- 实现 `TextSpec`、`LayerKind`、`Layer`、`ThemeColors`、`Theme`、`ThemeRegistry`、`AnimationSpec`、`EffectSpec`
- 将 `get_theme()` 逻辑迁移为 `ThemeRegistry::default_registry()` 中 5 个 Theme 构造函数
- 在 `main.rs` 添加 `mod layer;` 声明
- EffectSpec 变体全字段定义 + `#[allow(dead_code)]`

### Phase 3：迁移 text_renderer.rs

- `Renderer::new()` 改为接受 `&ThemeColors`
- 元素定位改用 `Placement::resolve()`
- 删除 `get_theme()` 函数（现在在 layer.rs）
- 现有测试适配：`get_theme()` 调用改为 `ThemeRegistry::default_registry().get("classic").unwrap().colors`

### Phase 4：迁移 image_stitcher.rs + preview.rs + main.rs

- `image_stitcher::stitch()` 接受 `&Theme`
- `LayoutContext::from_grid_layout()` 构建区域映射
- `preview.rs` 同步签名
- `main.rs` 使用 `ThemeRegistry` 查找主题；unknown theme → 列出所有 id，exit code 非零
- animation guard：`theme.animation.is_some()` → stderr + 非零退出

### Phase 5：测试适配与验证

- 所有现有 42 个测试用例适配新 API（不删除任何测试）
- 验证：5 个主题在相同 CLI 参数下生成图像与迁移前视觉一致（现有图像测试）
- `cargo test` 全部通过

---

## Key Design Decisions

| 决策 | 结论 | 理由 |
|------|------|------|
| ThemeColors 迁移位置 | 在 layer.rs 中定义，text_renderer.rs 从 `crate::layer` 引用 | 类型归属清晰；颜色组是 Theme 的一部分 |
| GridLayout 保留 vs 废弃 | 保留，LayoutContext 封装其计算结果 | 最小改动；GridLayout 内部细节不对外暴露 |
| TextSpec 位置 | 在 layer.rs（与 LayerKind 同文件） | LayerKind::TextBlock(TextSpec) 需要类型在同模块 |
| 主题迁移策略 | 一次性全部迁移（非增量） | SC-001 要求 diff 为空验证，增量迁移不可验证 |
| TimestampPosition | 保留在 image_stitcher.rs | CLI 参数类型，与 clap 深度绑定；不是布局原语 |
| 5 主题 + transparent | transparent 主题也作为 Theme 值迁移（共 6 个） | text_renderer.rs 已有 transparent 变体，需覆盖 |

---

## Complexity Tracking

> 无 Constitution 违规，此节留空。
