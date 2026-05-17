# Data Model: Rust 渲染引擎重构——双锚点布局系统

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-05-17

---

## 实体概览

```
layout.rs
  ├── Anchor9
  ├── Insets
  ├── RegionId
  ├── Region
  ├── Placement
  └── LayoutContext

layer.rs
  ├── TextSpec
  ├── LayerKind
  │     └── uses Placement (from layout.rs)
  ├── Layer
  ├── ThemeColors
  ├── Theme
  ├── ThemeRegistry
  ├── AnimationSpec
  └── EffectSpec
```

---

## layout.rs 实体

### Anchor9

9 方位枚举，表示矩形区域上的参考点。

```rust
pub enum Anchor9 {
    TopLeft, TopCenter, TopRight,
    MidLeft, Center,   MidRight,
    BotLeft, BotCenter, BotRight,
}
```

**用途**：`Placement` 中的 `parent_anchor`（父区域参考点）和 `self_anchor`（自身对齐点）。

---

### Insets

四边边距描述，单位像素（f32）。

```rust
pub struct Insets {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}
```

**工厂方法**：
- `Insets::all(v)` — 四边相同
- `Insets::xy(x, y)` — 水平/垂直对称
- `Insets::zero()` — 全零

---

### RegionId

父区域枚举，作为 `Placement.parent` 的值。

```rust
pub enum RegionId {
    Canvas,           // 整个画布
    Header,           // 顶部信息条
    Grid,             // 缩略图网格区域（不含 Header）
    Cell(u32, u32),   // 第 col 列第 row 行的单个缩略图单元格
    QrStrip,          // 右侧 QR 码竖条
}
```

**约束**：`Cell(col, row)` 的 col/row 超出网格范围时，`LayoutContext::region()` 返回 `Err`，不 panic。

---

### Region

像素矩形，表示一个区域的实际坐标和尺寸。

```rust
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}
```

---

### Placement

双锚点定位描述符。描述"自身哪个点对齐到父区域哪个点，再偏移多少像素"。

```rust
pub struct Placement {
    pub parent: RegionId,
    pub parent_anchor: Anchor9,
    pub self_anchor: Anchor9,
    pub offset: (f32, f32),
    pub padding: Insets,
    pub margin: Insets,
}
```

**字段语义**：
- `parent` — 参考区域
- `parent_anchor` — 父区域上的参考点坐标
- `self_anchor` — 自身矩形上与父锚点对齐的点
- `offset` — 对齐后的额外像素偏移 (dx, dy)
- `padding` — 内边距，影响内容在自身 box 内的起始位置
- `margin` — 外边距，影响元素起始位置（非 CSS reflow 语义）

**方法**：
- `Placement::resolve(&self, ctx: &LayoutContext, self_w: u32, self_h: u32) -> (u32, u32)` — 计算元素左上角的绝对像素坐标
- 超出父区域边界时裁剪到父区域，不 panic

---

### LayoutContext

预计算的所有区域像素矩形映射，渲染前一次性构建。

```rust
pub struct LayoutContext {
    canvas: Region,
    header: Region,
    grid: Region,
    cells: Vec<Region>,   // cells[row * cols + col]
    qr_strip: Option<Region>,
    rows: u32,
    cols: u32,
}
```

**构建**：
```rust
LayoutContext::from_grid_layout(gl: &GridLayout) -> Self
```

**查找**：
```rust
fn region(&self, id: RegionId) -> Result<Region, LayoutError>
```

---

## layer.rs 实体

### TextSpec

文字块的内容与样式描述。

```rust
pub struct TextSpec {
    pub text: String,
    pub font_size: u32,
    pub color: [u8; 4],   // RGBA
}
```

---

### LayerKind

层内容枚举，区分静态内容类型与动画占位。

```rust
pub enum LayerKind {
    SolidFill { color: [u8; 4] },
    BackgroundImage,
    TextBlock(TextSpec),
    QrCode,
    CellThumbnail { col: u32, row: u32 },
    TimestampBadge { col: u32, row: u32 },
    Effect(EffectSpec),   // 004 阶段不渲染，仅类型占位
}
```

---

### Layer

单个视觉层，包含渲染顺序、定位和内容。

```rust
pub struct Layer {
    pub z_order: i32,
    pub placement: Placement,
    pub kind: LayerKind,
}
```

**渲染规则**：`z_order` 升序绘制；相同 z_order 时后定义的在上方（稳定排序）。

---

### ThemeColors

主题颜色组，所有颜色为 RGBA `[u8; 4]`。

```rust
pub struct ThemeColors {
    pub canvas_bg: [u8; 4],
    pub header_bg: [u8; 4],
    pub text_primary: [u8; 4],
    pub text_secondary: [u8; 4],
    pub accent: [u8; 4],
    pub timestamp_bg: [u8; 4],
    pub timestamp_text: [u8; 4],
    pub qr_bubble_bg: [u8; 4],
    pub qr_module: [u8; 4],
    pub qr_finder_dark: [u8; 4],
    pub qr_finder_light: [u8; 4],
}
```

> 注：现有 `ThemeColors` 部分字段为 `[u8; 3]` RGB。迁移时统一扩展为 `[u8; 4]` RGBA（alpha=255 表示不透明）。

---

### Theme

主题数据值，完整描述一个视觉主题。

```rust
pub struct Theme {
    pub id: &'static str,
    pub colors: ThemeColors,
    pub layers: Vec<Layer>,
    pub animation: Option<AnimationSpec>,
}
```

**内置主题 id**：`"classic"` | `"dark"` | `"light"` | `"cinematic"` | `"minimal"` | `"transparent"`

---

### ThemeRegistry

主题集合，提供按 id 查找接口。

```rust
pub struct ThemeRegistry {
    themes: Vec<Theme>,
}

impl ThemeRegistry {
    pub fn default_registry() -> Self;           // 注册 6 个内置主题
    pub fn get(&self, id: &str) -> Option<&Theme>;
    pub fn ids(&self) -> Vec<&str>;
}
```

**约束**：若 `default_registry()` 返回空集合，启动时 panic 并提示 `"no themes registered"`。

---

### AnimationSpec

动画规格，004 阶段仅作类型定义，不实现任何渲染函数。

```rust
pub struct AnimationSpec {
    pub fps: u32,
    pub loop_secs: f32,
    pub effects: Vec<EffectSpec>,
}
```

---

### EffectSpec

效果枚举，004 阶段全字段定义，加 `#[allow(dead_code)]`。

```rust
#[allow(dead_code)]
pub enum EffectSpec {
    LightStreak {
        angle_deg: f32,
        width_frac: f32,
        speed: f32,
        color: [u8; 4],
        count: u32,
        z_order: i32,
    },
    Meteor {
        spawn_edge: SpawnEdge,   // Top | Bottom | Left | Right
        angle_deg: f32,
        length: f32,
        color: [u8; 4],
        per_loop: u32,
        z_order: i32,
    },
    GlowPulse {
        target: RegionId,
        color: [u8; 4],
        pulse_hz: f32,
        radius: f32,
        z_order: i32,
    },
}

pub enum SpawnEdge { Top, Bottom, Left, Right }
```

---

## 状态迁移

```
现有: get_theme(name: &str) -> ThemeColors   [text_renderer.rs]
迁移: ThemeRegistry::default_registry()      [layer.rs]
       └─ 每个主题 → Theme { id, colors, layers: vec![], animation: None }
          （layers 先置空，Phase 3/4 逐步填入 Placement）

现有: image_stitcher::stitch(..., color_theme: &str)
迁移: image_stitcher::stitch(..., theme: &Theme)

现有: text_renderer::Renderer::new(..., color_theme: &str)
迁移: text_renderer::Renderer::new(..., colors: &ThemeColors)
```

---

## 验证规则

| 规则 | 来源 |
|------|------|
| `Cell(col, row)` 越界 → `Err`，不 panic | spec Edge Cases |
| `Placement` 超出父区域 → 裁剪到边界 | spec Edge Cases |
| ThemeRegistry 空 → 启动 panic | spec Edge Cases |
| `Theme.animation.is_some()` → 非零退出，不写文件 | FR-012 |
| 相同 z_order → 后定义者在上（稳定排序） | User Story 3 AS-2 |
