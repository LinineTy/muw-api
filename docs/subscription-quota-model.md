# 订阅配额模型：动态窗口模型（唯一模型）

> 状态：**仅动态窗口模型**。legacy（经典周期/周/月上限）已移除——v16 schema 迁移删除
> 了 `subscription_plans` 的 `total_amount`/`quota_reset_period`/`quota_reset_custom_seconds`/
> `reset_amount_limit`/`weekly_amount_limit`/`monthly_amount_limit` 六列与
> `user_subscriptions` 的 `cycle_start_at`/`cycle_used`/`next_cycle_reset_at` 三列。
> 本文档描述当前唯一的配额模型语义、校验、运行时行为与代码落点。

## 背景

订阅配额曾经是单套 legacy 模型（套餐配 `quota_reset_period` + 周/月上限，订阅维护
`cycle_used`/`week_used`/`month_used`），存在结构性限制（周期相对订阅而非自然日历、无法表达
"每 5 小时 X 额度 + 每月 Y 额度"多级窗口、周/月自然上限与订阅周期纠缠）。动态窗口模型
（`reset_windows`）引入后逐步取代 legacy，v16 起彻底移除 legacy，动态窗口成为唯一模型。

## 模型语义

- **额度全部来自套餐的窗口列表**：`reset_windows`（JSON 数组，`ResetWindow{unit,value,limit}`，
  unit: hour/day/week/month）。每个窗口独立计数、按各自 cadence 刷新。
- **订阅计数**：`window_state`（`WindowState{idx,cycle_used,cycle_start_at,next_reset_at}`
  数组，按 index 对应套餐窗口）。`period_used` 是单期账本（当前预付期内累计消耗，quota
  units，续费清零）——只供退款 clamp 与审计，不是额度上限；`week_used`/`month_used`
  是自然日历展示统计（钱包卡「订阅抵扣」），也不是上限。
- **剩余额度**：`subscriptionRemainingWindows` = 所有窗口 `limit − cycle_used` 取最小。
- **无限额度**：全部窗口 `limit ≤ 0` → `subscriptionRemainingWindows` 返回 `math.MaxInt64`，
  预扣不设额度门。运行时天然支持，校验层也放行（见下）。
- **封顶语义**：窗口时长 ≥ 订阅剩余有效期 → `next_reset_at=0` 封顶，该窗口 limit 即本订阅
  总上限（订阅期内不刷新；续费拉长 EndTime 后可能恢复按 cadence 重置）。
- **续费**：延长 `end_time`、清零 `period_used`（开启新预付期），不累加、不清空窗口
  （不吞掉下一次重置）。
- **单期账本与退款 clamp**：`period_used` 与窗口计数是两本账——窗口计数响应运营操作
  （管理端手动重置、"改动即重置"），账本只进不退（除结算 delta 修正）。同互斥组升降配
  退款 = min(按时间折算的剩余价值, max(0, 快照价格 − period_used/QuotaPerUnit))：
  已消耗价值抵扣退款上限，堵"消耗即时、退款线性"的烧爆降级套利；误差方向恒为少退。

### 窗口状态机（`advanceWindowState`）

- 未武装（`cycle_start_at==0 && next_reset_at==0`）→ 从 now 武装。
- 封顶态（`next_reset_at==0 && cycle_start_at>0`）→ 下一次重置超出 EndTime，计数持续累计
  不刷新；续费延长 EndTime 后重算边界，可能恢复重置。
- 到期（`next_reset_at ≤ now`）→ 清零重武装（可能回到封顶态）。

## 套餐校验（controller/subscription.go `validatePlanResetWindows`）

- `reset_windows` 必须非空、至少一个窗口；空串/空数组拒绝（legacy 已移除，无"无窗口"模型）。
- 窗口校验：unit 白名单、`value > 0`、`limit ≥ 0`、时长严格递增（月按 30 天估，与前端一致）、
  时长 ≤ 一年（防 `time.Duration` 溢出）。
- **全部窗口 `limit = 0` = 无限额度，合法**（无需 legacy 的 `total_amount=0` 出口）。

## 运行时行为

额度判定与扣费全部以订阅所属套餐的窗口列表为准：

| 操作 | 行为 |
|---|---|
| 预扣 `PreConsumeUserSubscription` | 各窗口 `cycle_used` 累加 + 单期账本 `period_used` 累加 + 日历 `week_used/month_used` 展示累加 |
| 结算 `PostConsumeUserSubscriptionDelta` | 窗口计数按 delta 修正（正补负退、clamp），`period_used` delta 修正，日历计数 clamp |
| 退款 `RefundSubscriptionPreConsume` | 幂等，对全部窗口 clamp |
| 续费 `RenewSubscriptionTx` | 延长 `end_time` + 清零 `period_used`（新预付期），窗口不动 |
| 升降配切换 `PurchaseWithStrategy` | 退款 = min(时间剩余价值, max(0, 快照价格 − period_used 折算))，clamp 双向生效 |
| 窗口推进 `advanceSubscriptionWindows` | 各窗口按 cadence 独立推进 + 日历周/月仅作展示清零 |
| 管理端手动重置 | 全部窗口清零重锚（不动 `period_used`——窗口与账本是两本账） |

> **惰性推进**：窗口重置只发生在预扣路径（`PreConsumeUserSubscription` 先推进再判额度），
> 维护任务不扫动态窗口（`ResetDueSubscriptions` 已随 legacy 移除）。因此没有新请求时，
> 钱包/订阅卡展示的是上次调用后的计数快照——正确性不受影响，展示会滞后到下一次请求。

## 模型切换（改动即重置）

管理端保存套餐时窗口列表语义变化（`ResetWindowsEqual` 语义判等，非字节比较）触发
`ApplyPlanWindowsToActiveSubscriptions`：重置该套餐全部活跃订阅的窗口计数、从 now 锚定。

> 判等用语义比较（解析后逐项比对），键序/空白/美元额度浮点往返差异不算窗口变化，避免
> "只改标题"就清空所有用户的当期额度。前端确认弹窗同样用 `resetWindowsRawEqual`。

## 前端展示

- 钱包订阅卡 / 我的订阅 `buildLimitRows`：动态逐窗口渲染 `used/total`；全部窗口额度 0 =
  无限额度，返回空行由调用方显示 `Unlimited`。封顶窗口（后端状态 `next_reset_at==0 &&
  cycle_start_at>0`）优先按后端状态标「Total cap」；无订阅状态（套餐目录、购买/续费弹窗）
  才用 `isCapWindow` 时长估算（月≈30 天、`duration > validity`，与后端 `next > end` 对齐）。
- 管理端订阅列表 / 历史订阅 `usage` 列与「用户订阅」弹窗的额度列同样走 `buildLimitRows`：
  逐窗口渲染用量（套餐快照 `reset_windows` + 订阅 `window_state`）。`period_used` 是
  单期账本，不是展示额度。管理列表接口在 `AdminUserSubscriptionSummary`
  里附带完整套餐快照（`plan`），套餐被删时缺省并按 `Unlimited` 显示。
- 目录/弹窗窗口摘要：`{{amount}} every {{period}}`（普通窗口）/ `{{amount}} total`（封顶）。
- 行 key 用 `unit-value`，多个封顶窗口不会 key 冲突。

## 钱包「订阅抵扣」统计口径

钱包余额卡「订阅抵扣」= 生效订阅 `month_used` 之和（自然日历月口径）。动态窗口下
`month_used` **不是**上限（上限只来自窗口），但同样维护为展示统计——预扣累加、结算差额
修正、自然月边界清零。

> 注：系统在每条消费日志的 `other.billing_source` 上记录了该笔是 `wallet` 还是
> `subscription`（service/log_info_generate.go），但它是 JSON 字段、非日志表列，暂未用于
> 统计。若将来要做"按来源出报表"，需要把 `billing_source` 提升为日志表真列（注意
> ClickHouse 等日志库的兼容），属另一件事。

## 代码落点

| 职责 | 位置 |
|---|---|
| 窗口解析/剩余额度 | `model/subscription.go`：`ResetWindows()`、`subscriptionRemaining`、`subscriptionRemainingWindows` |
| 窗口状态机 | `model/subscription.go`：`advanceSubscriptionWindows`、`advanceWindowState`、`advanceDynamicWindows`、`calcWindowNextReset` |
| 预扣/结算/退款 | `model/subscription.go`：`PreConsumeUserSubscription`、`PostConsumeUserSubscriptionDelta`、`RefundSubscriptionPreConsume` |
| 续费/创建/过期 | `model/subscription.go`：`RenewSubscriptionTx`、`CreateUserSubscriptionFromPlanTx`、`ExpireDueSubscriptions` |
| 套餐校验 | `controller/subscription.go`：`validateResetWindows`、`validatePlanResetWindows` |
| 改动即重置 | `controller/subscription.go`（`AdminUpdateSubscriptionPlan`）+ `model/subscription.go`：`ApplyPlanWindowsToActiveSubscriptions`、`ResetWindowsEqual` |
| 前端限额行/摘要 | `web/src/features/subscriptions/lib/window-usage.ts`（`buildLimitRows`，钱包卡/管理端用量列/弹窗共用）、`web/src/features/subscriptions/lib/format.ts` |
| 管理端用量列数据 | `model/subscription.go`：`AdminUserSubscriptionSummary.Plan`（admin 列表附带套餐快照） |
| 订阅抵扣统计 | 后端维护 `month_used`（`model/subscription.go`）；前端 `web/src/features/wallet/components/wallet-stats-card.tsx` |
