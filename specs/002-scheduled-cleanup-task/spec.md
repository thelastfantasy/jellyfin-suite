# Feature Specification: 播放记录定时清理任务

**Feature Branch**: `002-add-play-history-cleanup`
**Created**: 2026-05-11
**Status**: Draft
**Input**: User description: "添加定时清理任务，清理 play_history 表中超过保留期限的播放记录，通过 Jellyfin IScheduledTask 接口实现，兼容 Jellyfin 10.8.x ~ 10.11.x"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 自动清理过期记录 (Priority: P1)

系统管理员安装插件后，插件在后台自动定期清理超过保留期限的播放历史记录，无需任何手动干预。管理员可以在 Jellyfin Dashboard 的 Scheduled Tasks 页面看到该任务的存在和上次执行状态。

**Why this priority**: 这是功能的核心价值——自动维持数据库文件大小在合理范围内，是所有其他能力的基础。

**Independent Test**: 安装插件并等待一个触发周期后，检查 play_history 表中所有记录的 played_at 时间戳均不超过保留期限，且 Dashboard Tasks 页面显示最近一次执行状态。

**Acceptance Scenarios**:

1. **Given** 插件已安装且 play_history 表中有 30 天前、60 天前、120 天前的播放记录，默认保留 90 天，**When** 清理任务执行完成，**Then** 只有 30 天前和 60 天前的记录保留，120 天前的记录已被删除
2. **Given** 数据库中所有记录均在保留期限内，**When** 清理任务执行，**Then** 没有记录被删除，任务执行结果显示"0 条记录已清理"
3. **Given** 插件首次安装（play_history 表尚不存在），**When** 清理任务执行，**Then** 任务正常完成，不报错

---

### User Story 2 - 手动触发清理 (Priority: P2)

管理员可以在 Jellyfin Dashboard → Scheduled Tasks 页面找到该清理任务，随时点击"Run"按钮手动执行一次清理。执行过程中显示进度百分比，完成后显示清理了多少条记录。

**Why this priority**: 手动触发为管理员提供即时控制权，是自动清理的有力补充——例如在迁移数据后立即清理、或在调整保留期限后立即使其生效。

**Independent Test**: 在 Dashboard Tasks 页面找到任务并点击 Run，验证任务执行后过期记录被删除、进度条正确推进、结果面板显示清理条数。

**Acceptance Scenarios**:

1. **Given** Dashboard Tasks 页面加载，**When** 管理员查看看任务列表，**Then** 在"Jellyfin Recents"分类下看到名为"清理过期播放记录"的任务，包含描述、上次运行时间和启用/禁用开关
2. **Given** 管理员点击该任务的"Run"按钮，**When** 任务执行中，**Then** 进度从 0% 逐步推进到 100%，期间可看到当前进度百分比
3. **Given** 管理员在任务执行过程中触发服务器关闭，**When** 服务器重启，**Then** 任务状态为"已中止"(Aborted)，不会留下不完整的数据状态

---

### User Story 3 - 配置保留期限 (Priority: P3)

管理员可以在插件配置页面调整播放记录的保留天数（如 30 天、60 天、180 天），调整后下次清理任务执行时自动采用新值。

**Why this priority**: 提供灵活性，但默认值已满足大多数场景。可在后续迭代中根据需要优先级调整。

**Independent Test**: 修改保留天数为 30 天，触发清理，验证只删除超过 30 天的记录。

**Acceptance Scenarios**:

1. **Given** 插件使用默认保留 90 天，**When** 管理员将保留期限改为 30 天并保存，**Then** 下次清理任务执行时，超过 30 天的记录被删除
2. **Given** 管理员将保留期限设为 0 或负数，**When** 保存配置，**Then** 系统拒绝该值并保持上次有效值，或使用默认值
3. **Given** 管理员调整保留期限后，**When** 任务下次自动触发（无需手动触发），**Then** 新配置值生效

---

### Edge Cases

- play_history 表中记录量极大（数万条单用户 / 数十万条多用户总计）时，删除操作是否会导致数据库长时间锁定？（假设：使用分批删除，每批最多 1000 条，每批之间检查取消令牌，避免长时间锁表阻塞正常写入）
- 数据库文件本身不存在时（首次安装、尚未写入任何记录），清理任务是否正常跳过而不报错？
- 保留期限被设为 0 时如何处理？（假设：不允许为 0 或负数，必须 ≥ 1；无效值回退到默认 90 天）
- 多个用户同时写入播放记录时，清理任务是否阻塞正常业务写入？（假设：WAL 模式下读/写操作与清理删除的互斥影响极小，可忽略）
- 未来新增 favorite_record 表是否也需要清理？（本次范围仅限 play_history 表，收藏记录量级很小，暂不纳入）

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须通过 Jellyfin IScheduledTask 接口注册定时清理任务，在插件加载时由 Jellyfin 运行时自动发现并注册
- **FR-002**: 清理任务必须在 Dashboard → Scheduled Tasks 页面中以"Jellyfin Recents"分类显示，任务名称为"清理过期播放记录"
- **FR-003**: 清理任务必须带有默认触发器，每 24 小时自动执行一次
- **FR-004**: 清理任务必须删除 play_history 表中 played_at 早于"当前时间 - 保留期限"的所有记录
- **FR-005**: 保留期限默认值必须为 90 天，可通过插件配置项修改
- **FR-006**: 保留期限配置值必须验证为 ≥ 1 的正整数，无效值回退到默认 90 天
- **FR-007**: 清理任务必须报告进度（0% → 50% 开始删除 → 100% 完成），每个阶段的百分比反映实际工作进展
- **FR-008**: 清理任务必须支持取消操作：响应 `CancellationToken`，在每批删除之前检查取消状态，取消时将已删除的批次正常提交，未处理的批次保留
- **FR-009**: 清理任务必须使用分批删除策略，每批删除不超过 1000 条记录，批次之间提交事务并检查取消令牌
- **FR-010**: 清理任务执行完成后必须记录清理的条目数量，通过 Jellyfin Tasks 框架的结果机制可查看
- **FR-011**: 当数据库文件或 play_history 表不存在时，清理任务必须优雅跳过而非抛出异常
- **FR-012**: 清理任务必须兼容 Jellyfin 10.8.0 到 10.11.x 版本（targetAbi 10.8.0.0）
- **FR-013**: 清理任务必须使用单次 DELETE 语句（带 WHERE 条件），在执行之前先获取待删除行数用于报告结果

### Key Entities

- **CleanupTask**: 实现 IScheduledTask 的定时任务类，包含任务元数据（名称、描述、分类、默认触发器）和执行逻辑
- **RetentionConfig**: 插件配置中的保留期限字段，正整数天数，默认 90
- **TaskResult**: 任务执行结果，包含已清理的记录数量，由 Jellyfin 任务框架持久化显示

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 清理任务执行后，play_history 表中不存在 played_at 早于保留期限的记录
- **SC-002**: 单次清理包含 50000 条过期记录的表，总耗时不超过 10 秒（普通硬件条件下）
- **SC-003**: Dashboard Tasks 页面中该任务的上次执行状态正确反映成功/失败/已取消
- **SC-004**: 修改保留期限配置后，下一次清理执行（无论自动或手动）均采用新配置值
- **SC-005**: 清理任务执行期间，正常的播放记录写入操作（INSERT）不受阻塞或错误影响
- **SC-006**: 任务被取消时，已删除的批次已提交、未处理的批次完好保留，不产生数据不一致
- **SC-007**: 任务在 Jellyfin 10.8.x 和 10.10.x / 10.11.x 服务器上均可被自动发现并在 Dashboard Tasks 页面显示

## Assumptions

- 仅清理 play_history 表，不涉及 favorite_record 表（收藏记录量级极小，无需清理）
- 分批删除策略（每批 1000 条）在大多数硬件上不会导致显著的数据库锁定
- SQLite WAL 模式下，删除操作与日常写入的并发互斥开销可忽略
- 管理员理解保留期限的含义——调整后立即可通过手动触发使新值生效
- 清理任务的默认 24 小时触发间隔在 Jellyfin 重启后仍按计划执行（由 Jellyfin 内部调度器管理）
- 未来如需更精细的配置 UI（如 Jellyfin 插件配置页面中的滑块控件），作为独立迭代处理
