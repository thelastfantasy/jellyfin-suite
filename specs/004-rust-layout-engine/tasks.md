# Tasks: Rust 渲染引擎重构——双锚点布局系统

**Input**: Design documents from `specs/004-rust-layout-engine/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description with file path`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup

**Purpose**: 声明新模块，建立编译基线

- [ ] T001 Add `mod layout;` and `mod layer;` declarations to `src/poster-gen/src/main.rs` (two lines in the existing mod block at the top of the file)

---

## Phase 2: Foundational（类型定义，阻塞所有用户故事）

**Purpose**: 创建 layout.rs 和 layer.rs 两个新模块的完整类型定义。两个文件相互独立，可并行完成。

**⚠️ CRITICAL**: 所有用户故事的实现任务依赖本阶段完成

- [ ] T002 [P] Create `src/poster-gen/src/layout.rs` — implement the following in order: (1) `pub enum Anchor9` with 9 variants (TopLeft/TopCenter/TopRight/MidLeft/Center/MidRight/BotLeft/BotCenter/BotRight); (2) `pub struct Insets { pub top/right/bottom/left: f32 }` with `all(v)`, `xy(x,y)`, `zero()` constructors; (3) `pub enum RegionId` with Canvas/Header/Grid/Cell(u32,u32)/QrStrip variants; (4) `pub struct Region { pub x/y/w/h: u32 }`; (5) `pub struct Placement { pub parent: RegionId, parent_anchor: Anchor9, self_anchor: Anchor9, offset: (f32,f32), padding: Insets, margin: Insets }` — all fields pub; (6) `pub struct LayoutContext { canvas/header/grid: Region, cells: Vec<Region>, qr_strip: Option<Region>, rows/cols: u32 }` — skeleton only, methods in Phase 4; add Rust doc comments to every pub type

- [ ] T003 [P] Create `src/poster-gen/src/layer.rs` — implement the following in order: (1) `pub struct TextSpec { pub text: String, font_size: u32, color: [u8;4] }`; (2) `pub enum LayerKind` with variants SolidFill { color:[u8;4] }, BackgroundImage, TextBlock(TextSpec), QrCode, CellThumbnail { col:u32, row:u32 }, TimestampBadge { col:u32, row:u32 }, Effect(EffectSpec); (3) `pub struct Layer { pub z_order: i32, placement: Placement, kind: LayerKind }` (import Placement from crate::layout); (4) pub z_order constants: `Z_CANVAS_BG=0`, `Z_BG_IMAGE=10`, `Z_CELL_THUMB=20`, `Z_EFFECT_BELOW=25`, `Z_HEADER_BG=30`, `Z_EFFECT_ABOVE=35`, `Z_TEXT_OVERLAY=40`, `Z_QR=40`, `Z_ICON=41`, `Z_TIMESTAMP=45`; (5) `pub struct ThemeColors` with 11 RGBA `[u8;4]` fields: canvas_bg/header_bg/text_primary/text_secondary/accent/timestamp_bg/timestamp_text/qr_bubble_bg/qr_module/qr_finder_dark/qr_finder_light; (6) `pub struct Theme { pub id: &'static str, pub colors: ThemeColors, pub layers: Vec<Layer>, pub animation: Option<AnimationSpec> }`; (7) `pub struct ThemeRegistry { themes: Vec<Theme> }` with `pub fn get(&self, id: &str) -> Option<&Theme>`, `pub fn ids(&self) -> Vec<&str>`, `pub fn default_registry() -> Self { ThemeRegistry { themes: vec![] } }` (stub — filled in Phase 3); (8) `pub struct AnimationSpec { pub fps: u32, pub loop_secs: f32, pub effects: Vec<EffectSpec> }`; (9) `pub enum SpawnEdge { Top, Bottom, Left, Right }`; (10) `#[allow(dead_code)] pub enum EffectSpec` with variants LightStreak { angle_deg:f32, width_frac:f32, speed:f32, color:[u8;4], count:u32, z_order:i32 }, Meteor { spawn_edge:SpawnEdge, angle_deg:f32, length:f32, color:[u8;4], per_loop:u32, z_order:i32 }, GlowPulse { target:RegionId, color:[u8;4], pulse_hz:f32, radius:f32, z_order:i32 }; add Rust doc comments to every pub type

**Checkpoint**: `cargo build` should compile with zero errors (empty ThemeRegistry, stub LayoutContext methods not yet implemented)

---

## Phase 3: User Story 1 — 数据驱动主题 (Priority: P1) 🎯 MVP

**Goal**: 新增主题只需构造一个 Theme 值，无需触碰任何渲染函数

**Independent Test**: 在 `layer.rs` 的 `default_registry()` 中新增 `Theme { id: "test-plain", colors: ThemeColors { … }, layers: vec![], animation: None }` 并 `cargo build`；不修改 text_renderer.rs 或 image_stitcher.rs 的任何渲染函数；运行 `poster-gen --color-theme test-plain` 生成图片成功

- [ ] T004 [US1] Implement `ThemeRegistry::default_registry()` in `src/poster-gen/src/layer.rs` — migrate all 6 themes from `get_theme()` in text_renderer.rs; for each theme (classic/dark/light/cinematic/minimal/transparent): copy exact RGBA color values (RGB→RGBA by appending 255 alpha) into the corresponding `ThemeColors` fields; set `layers: vec![]` (populated in Phase 5); set `animation: None`; the registry must contain all 6 themes in the order listed; after filling, add a debug_assert at end: `assert!(!registry.themes.is_empty(), "no themes registered")`

- [ ] T005 [P] [US1] Refactor `src/poster-gen/src/image_stitcher.rs` — change `stitch()` (and all internal functions that receive `color_theme: &str`) to accept `theme: &crate::layer::Theme` instead; replace every `get_theme(color_theme)` call with `theme.colors`; map old `ThemeColors` field names to new ones (accent_color → colors.accent, header_bg → colors.header_bg, text_color → colors.text_primary, etc.); keep all pixel-coordinate rendering logic unchanged

- [ ] T006 [P] [US1] Refactor `src/poster-gen/src/text_renderer.rs` — change `Renderer::new()` signature from `color_theme: &str` to `colors: &'a crate::layer::ThemeColors` (add lifetime if needed); remove the `get_theme()` function entirely; replace every old ThemeColors field access with the new RGBA field names from layer.rs; keep all existing rendering logic and tests structurally intact

- [ ] T007 [P] [US1] Update `src/poster-gen/src/preview.rs` — propagate `&Theme` / `&ThemeColors` through all function signatures; remove any `get_theme()` call; use `ThemeRegistry::default_registry().get(&args.color_theme)` to resolve the theme

- [ ] T008 [US1] Update `src/poster-gen/src/main.rs` — in both `run_generate()` and `run_preview()` flows: build `let registry = ThemeRegistry::default_registry();`; resolve `--color-theme` with `registry.get(&args.color_theme).ok_or_else(|| { eprintln!("Unknown theme '{}'. Available: {}", args.color_theme, registry.ids().join(", ")); })` and exit non-zero on None; add animation guard immediately before opening the output file: `if let Some(_) = theme.animation { eprintln!("animation not yet implemented for theme '{}'", theme.id); std::process::exit(1); }` (note: do NOT write any output file before this check)

**Checkpoint**: `cargo test` should pass; `poster-gen --color-theme classic` generates WebP; `poster-gen --color-theme bogus` prints available ids and exits 1

---

## Phase 4: User Story 2 — 双锚点定位 (Priority: P1)

**Goal**: 任意元素位置由 Placement 描述；调整位置只需修改 anchor 字段值，无需计算像素坐标

**Independent Test**: 将 classic 主题 TimestampBadge 的 Placement 中 `parent_anchor` 和 `self_anchor` 从 `BotLeft` 改为 `BotRight`，重新生成图片，徽章出现在单元格右下角，不修改任何坐标计算代码

- [ ] T009 [US2] Implement `LayoutContext::from_grid_layout(gl: &crate::image_stitcher::GridLayout) -> Self` in `src/poster-gen/src/layout.rs` — compute the following Regions: canvas `{ x:0, y:0, w: gl.canvas_w(), h: gl.canvas_h() }`; header `{ x:0, y:0, w: gl.icon_area_w, h: gl.header_h }`; grid `{ x: gl.pad, y: gl.header_h + gl.pad, w: gl.canvas_w() - 2*gl.pad - gl.qr_strip_w, h: gl.canvas_h() - gl.header_h - 2*gl.pad }`; cells: Vec of `gl.cell_origin(col, row)` + cell_w/cell_h for all rows×cols; qr_strip: `Some(Region { x: gl.icon_area_w, y:0, w: gl.qr_strip_w, h: gl.canvas_h() })` when qr_strip_w > 0, else None; implement `pub fn region(&self, id: RegionId) -> Result<Region, String>` — return Err("Cell out of bounds") for col≥cols or row≥rows, Err("QrStrip not available") when qr_strip is None

- [ ] T010 [US2] Implement `Placement::resolve(&self, ctx: &LayoutContext, self_w: u32, self_h: u32) -> (u32, u32)` in `src/poster-gen/src/layout.rs` — (1) call `ctx.region(self.parent)?` to get parent Region; (2) compute parent anchor point px: Anchor9::TopLeft→(region.x, region.y), TopCenter→(region.x + region.w/2, region.y), …, BotRight→(region.x+region.w, region.y+region.h); (3) compute element top-left: subtract self_anchor offset from anchor point (e.g. BotRight means element right=px, element bottom=py → top_left = (px - self_w, py - self_h)); (4) add self.offset.0 and self.offset.1; (5) add self.margin.left/top; (6) clamp to parent region boundaries (x in [region.x, region.x+region.w-self_w], y in [region.y, region.y+region.h-self_h]); return (x as u32, y as u32); return (region.x, region.y) on Err rather than panic

- [ ] T011 [US2] Refactor `src/poster-gen/src/text_renderer.rs` — in `Renderer::new()` and `Renderer::render()`: construct `LayoutContext::from_grid_layout(&gl)` (gl is passed in from image_stitcher); use `Placement::resolve()` to compute positions for: branding text (parent=Header, parent_anchor=MidRight, self_anchor=MidRight, offset=(-8,0)); info block (parent=Header, parent_anchor=TopLeft, self_anchor=TopLeft, offset=(8,8)); simultaneously update each built-in theme's `layers` field in `ThemeRegistry::default_registry()` in `src/poster-gen/src/layer.rs` to include a `Layer { z_order: Z_TEXT_OVERLAY, placement: Placement { … }, kind: LayerKind::TextBlock(…) }` for branding and info elements — these Placement values DRIVE the resolve() calls in Renderer

- [ ] T012 [US2] Update `src/poster-gen/src/image_stitcher.rs` — build `let ctx = LayoutContext::from_grid_layout(&gl);` in `stitch()`; pass `&ctx` to `Renderer::new()` and `Renderer::render()`; use `Placement::resolve()` for QrCode and TimestampBadge CellThumbnail position calculations (replacing hardcoded `gl.cell_origin(col, row)` offsets where timestamp badge offset is defined); update classic theme's TimestampBadge Layer placement in layer.rs to use Anchor9-based Placement that maps to the TimestampPosition enum value

**Checkpoint**: `cargo test` passes; adjusting two anchor fields in a theme's TimestampBadge Layer repositions the badge without touching image_stitcher.rs

---

## Phase 5: User Story 3 — Z-order 层级控制 (Priority: P2)

**Goal**: 渲染顺序完全由 z_order 值决定；与元素类型无关

**Independent Test**: 将 classic 主题 QrCode layer 的 z_order 改为 -1（低于 Z_CANVAS_BG），生成图片后 QR 码被画布背景遮盖（不可见）；改回 Z_QR=40，QR 码正常显示在前景

- [ ] T013 [US3] Update `src/poster-gen/src/image_stitcher.rs` — in `stitch()`: after building ctx, do `let mut layers = theme.layers.clone(); layers.sort_by_key(|l| l.z_order);` (stable sort); then iterate layers, match on `l.kind` and dispatch: SolidFill → fill canvas_bg; BackgroundImage → draw bg image; CellThumbnail { col, row } → place thumbnail; TimestampBadge { col, row } → draw timestamp; TextBlock → call Renderer; QrCode → draw QR strip; Effect(_) → `continue`; ensure the Effect arm does NOT panic and produces no output

- [ ] T014 [US3] Update `ThemeRegistry::default_registry()` in `src/poster-gen/src/layer.rs` — for each of the 6 built-in themes, populate the `layers` Vec with complete Layer entries for all visual elements they contain (using Z_* constants for z_order and Placement structs from Phase 4); minimum required layers per static theme: SolidFill (Z_CANVAS_BG), BackgroundImage (Z_BG_IMAGE) where applicable, CellThumbnail per cell (Z_CELL_THUMB), SolidFill for header (Z_HEADER_BG), TextBlock for branding/info (Z_TEXT_OVERLAY), QrCode (Z_QR), TimestampBadge per cell if show_timestamp (Z_TIMESTAMP)

**Checkpoint**: `cargo test` passes; z_order determines render order independent of LayerKind; Effect layer skipped silently

---

## Phase 6: User Story 4 — 动画前置接口 (Priority: P3)

**Goal**: AnimationSpec/EffectSpec 类型编译无错误；携带 AnimationSpec 的主题调用后非零退出

**Independent Test**: 在 default_registry() 中临时添加 `Theme { id: "anim-test", animation: Some(AnimationSpec { fps:15, loop_secs:4.0, effects:vec![] }), … }` 并通过 `--color-theme anim-test` 调用；exit code ≠ 0；stderr 含 `animation not yet implemented for theme 'anim-test'`；输出目录无新文件

- [ ] T015 [US4] Verify `src/poster-gen/src/layer.rs` — confirm `#[allow(dead_code)]` is present on both `EffectSpec` and `SpawnEdge`; confirm all 3 EffectSpec variant fields are correctly typed (f32/u32/i32/[u8;4]/RegionId/SpawnEdge); run `cargo build 2>&1 | grep -i "dead_code\|unused"` and confirm no dead_code warnings leak through for EffectSpec fields

- [ ] T016 [US4] Add unit test `animation_guard_exits_nonzero` in `src/poster-gen/src/image_stitcher.rs` (or `src/poster-gen/src/main.rs`) — construct `Theme { id: "anim-test", colors: ThemeRegistry::default_registry().get("classic").unwrap().colors.clone(), layers: vec![], animation: Some(AnimationSpec { fps: 15, loop_secs: 4.0, effects: vec![] }) }`; call the animation guard function (extract the guard logic into a testable `fn check_animation(theme: &Theme) -> Result<(), String>` returning Err with the expected message); assert `check_animation(&anim_theme).is_err()`; assert error string contains `"animation not yet implemented"`

**Checkpoint**: `cargo build` compiles cleanly; animation unit test passes; no EffectSpec dead_code warnings

---

## Phase 7: Polish & Test Adaptation

**Purpose**: 适配所有现有测试到新 API；验证测试总数不减少

- [ ] T017 [P] Adapt test `all_named_themes_have_visible_text` in `src/poster-gen/src/text_renderer.rs` — replace hardcoded `["classic", "dark", "light", "cinematic", "minimal"]` slice with `crate::layer::ThemeRegistry::default_registry().ids()` iteration; ensure the test still validates that each theme produces visible (non-zero pixel) text output

- [ ] T018 [P] Adapt test `unknown_theme_falls_back_to_classic` in `src/poster-gen/src/text_renderer.rs` — rename to `unknown_theme_not_in_registry`; assert that `crate::layer::ThemeRegistry::default_registry().get("not-a-real-theme")` returns `None` (previously this tested fallback behavior; now ThemeRegistry has no fallback — unknown = None)

- [ ] T019 [P] Adapt `overlay_fingerprint` test helper in `src/poster-gen/src/image_stitcher.rs` — update its signature to accept `theme: &crate::layer::Theme` instead of `color_theme: &str`; update all call sites (at least 5) to pass `ThemeRegistry::default_registry().get("classic").unwrap()` or the appropriate theme

- [ ] T020 Run `cargo test` from `src/poster-gen/` — verify all tests pass; print the total test count; confirm count is ≥ 42 (the pre-refactor baseline); if any test fails, fix the API mismatch before marking this task complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — T002 and T003 can run in parallel
- **Phase 3 (US1)**: Depends on Phase 2 complete — T005, T006, T007 can run in parallel; T008 depends on all three
- **Phase 4 (US2)**: Depends on Phase 3 complete — T009→T010 sequential (both in layout.rs); T011 and T012 depend on T009+T010
- **Phase 5 (US3)**: Depends on Phase 4 complete (needs theme.layers populated and LayoutContext built)
- **Phase 6 (US4)**: Depends on Phase 2 (layer.rs types) + Phase 3 T008 (animation guard in main.rs)
- **Phase 7 (Polish)**: Depends on all US phases complete; T017/T018/T019 can run in parallel; T020 must be last

### Within Each Phase

- Phase 2: T002 ‖ T003 (different files)
- Phase 3: T004 → {T005 ‖ T006 ‖ T007} → T008
- Phase 4: T009 → T010 → {T011 ‖ T012}
- Phase 5: T013 → T014
- Phase 6: T015 ‖ T016
- Phase 7: {T017 ‖ T018 ‖ T019} → T020

---

## Parallel Example: Phase 3 (US1)

```
After T004 completes:

  [parallel]
  ├── T005: image_stitcher.rs  →  accept &Theme
  ├── T006: text_renderer.rs   →  accept &ThemeColors, remove get_theme()
  └── T007: preview.rs         →  propagate &Theme

  [sequential after all three]
  └── T008: main.rs            →  ThemeRegistry lookup + error handling + animation guard
```

---

## Implementation Strategy

### MVP First (Phase 1–3: US1 only)

1. Phase 1: Add mod declarations
2. Phase 2: Define all types in layout.rs and layer.rs
3. Phase 3: Migrate themes to data values + wire up ThemeRegistry in main.rs
4. **STOP and VALIDATE**: Run `cargo test`; call `poster-gen --color-theme classic`; verify output; call `poster-gen --color-theme bogus` → confirm error + id list

### Incremental Delivery

1. Phase 1–3 → Themes as data, ThemeRegistry works → SC-001 verifiable (git diff shows empty render function diff)
2. Phase 4 → Placement system live → SC-004 verifiable (≤5 lines to reposition element)
3. Phase 5 → Z-order drives render loop → SC-002 verifiable (visual parity with pre-refactor)
4. Phase 6 → Animation guard + type safety → SC-005 verifiable
5. Phase 7 → SC-003 verifiable (cargo test count ≥ 42)

---

## Notes

- **No new crates**: Do not add any entry to `src/poster-gen/Cargo.toml`
- **TimestampPosition**: Keep `TimestampPosition` enum in image_stitcher.rs — it is a CLI arg type, not a layout primitive
- **transparent theme**: Has 6 themes total (classic/dark/light/cinematic/minimal/transparent); transparent was already in the old match arms
- **ThemeColors field rename**: Old `text_color` → `text_primary`; `accent_color` → `accent`; old RGB [u8;3] → RGBA [u8;4] with alpha=255
- **Test count baseline**: 42 tests before refactor; Polish phase must not reduce this count
- **SC-001 verification**: After Phase 3, run `git diff HEAD -- src/poster-gen/src/image_stitcher.rs src/poster-gen/src/text_renderer.rs`; adding a 7th theme should show diff only in layer.rs
