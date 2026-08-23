# 订阅配额模型：legacy 与动态窗口双轨共存

> 状态：**双轨共存已实现**。legacy（经典周期/周/月上限）与动态窗口（reset_windows）
> 两套配额模型并行运行，以「套餐」为单位选型。本文档描述两套模型的语义、共存边界、
> 切换行为与代码落点。

## 背景

订阅配额历史上只有一套模型：套餐上配 `quota_reset_period`（日/周/月/自定义）加
`weekly_amount_limit` / `monthly_amount_limit`，订阅行上维护 `cycle_used` /
`week_used` / `month_used` 等计数。这套模型存在一些结构性限制（周期相对订阅而非自然
日历、无法表达"每 5 小时 X 额度 + 每月 Y 额度"这类多级窗口、周/月自然上限与订阅周期
互相纠缠），于是引入了**动态窗口模型**：套餐声明一组独立窗口，订阅上每个窗口独立计数、
按各自 cadence 刷新。

为了不破坏存量套餐与订阅，新模型作为**并行轨道**加入，而非替换。

## 两套模型一览

| 维度 | legacy | 动态窗口 |
|---|---|---|
| 套餐判定 | `reset_windows` 为空 | `reset_windows` 非空（JSON 数组） |
| 额度来源 | `total_amount` + `quota_reset_period` + `reset_amount_limit` + `weekly/monthly_amount_limit` | 各 `ResetWindow{unit,value,limit}`（unit: hour/day/week/month） |
| 订阅计数 | `amount_used` / `cycle_used` / `week_used` / `month_used` | `window_state`（`WindowState{idx,cycle_used,cycle_start_at,next_reset_at}` 数组，按 index 对应套餐窗口） |
| 剩余额度 | `subscriptionRemaining`：多上限取最小 | `subscriptionRemainingWindows`：所有窗口 `limit − cycle_used` 取最小 |
| 续费 | 延长 `end_time`，`amount_total` 累加 | 只延长 `end_time`，**不**累加 `amount_total`（授权归窗口） |
| 封顶语义 | 无（靠各上限） | 窗口时长 ≥ 订阅剩余有效期 → `next_reset_at=0` 封顶，limit 即该订阅总上限 |
| 周/月自然日历上限 | 是真实上限 | 仅作展示统计，**不是**上限 |

## 套餐选型与互斥

- 一个套餐同一时刻只能属于一种模型。`validatePlanResetWindows`（controller/subscription.go）
  强制：`reset_windows` 非空时，`quota_reset_period`（非 never）、`reset_amount_limit`、
  `weekly_amount_limit`、`monthly_amount_limit` 必须为 0/never，且至少一个窗口 `limit > 0`。
- 窗口校验：unit 白名单、`value > 0`、`limit ≥ 0`、时长严格递增（月按 30 天估，与前端一致）、
  时长 ≤ 一年（防 `time.Duration` 溢出）。
- **不同套餐可以混用模型**：A 套餐 legacy、B 套餐动态，互不影响。

## 运行时行为

额度判定与扣费全部以「**订阅所属套餐的当前模型**」为准（运行时读 `plan.ResetWindows()`
分叉，不依赖订阅上残留的旧计数）：

| 操作 | legacy | 动态窗口 |
|---|---|---|
| 预扣 `PreConsumeUserSubscription` | `amount_used/cycle/week/month` 全部累加 | 各窗口 `cycle_used` 累加 + 日历 `week_used/month_used` 展示累加 |
| 结算 `PostConsumeUserSubscriptionDelta`（delta=实际−预扣） | 各计数按 delta 修正，累计有 guard | 窗口计数按 delta 修正并跳过累计 guard（HOLE D），日历计数 clamp |
| 退款 `RefundSubscriptionPreConsume` | 幂等，负 delta | 幂等，对全部窗口 clamp |
| 续费 `RenewSubscriptionTx` | 延长 `end_time`，`amount_total` 累加 | 只延长 `end_time`，不累加、不清空窗口（不吞下一次重置） |
| 窗口推进 `advanceSubscriptionWindows` | 周期到期清零重武装 + 自然周/月边界清零 | 各窗口按 cadence 独立推进 + 日历周/月仅作展示清零 |
| 管理端手动重置 | 周期/周/月清零重锚 | 全部窗口清零重锚 |

### 动态窗口状态机（`advanceWindowState`）

- 未武装（`cycle_start_at==0 && next_reset_at==0`）→ 从 now 武装。
- 封顶态（`next_reset_at==0 && cycle_start_at>0`）→ 下一次重置超出 EndTime，计数持续
  累计不刷新；续费延长 EndTime 后重算边界，可能恢复重置（HOLE A：边界已过则立即重置）。
- 到期（`next_reset_at ≤ now`）→ 清零重武装（可能回到封顶态）。

## 共存边界

- **存量订阅不迁移**：升级前创建的订阅 `window_state` 为空，继续走 legacy 语义。
- **同一用户可同时持有 legacy 与动态订阅**：预扣按消费优先级逐个取，各按自己模型判额度。
- 一个订阅的模型跟随其**当前套餐**的模型：管理员切换套餐模型时，该套餐全部活跃订阅
  被重置到新模型的计数（见下）。

## 模型切换（改动即重置）

管理端保存套餐时，窗口列表语义变化（`ResetWindowsEqual` 语义判等，非字节比较）触发：

- **legacy → 动态**：`ApplyPlanWindowsToActiveSubscriptions` 清空全部窗口计数、从 now 锚定。
- **动态 → legacy**：`ApplyPlanLegacyToActiveSubscriptions` 重授 `total_amount`、周期/周/月清零、
  清空 `window_state`。

> 判等用语义比较（解析后逐项比对），键序/空白/美元额度浮点往返差异不算窗口变化，
> 避免"只改标题"就清空所有用户的当期额度。前端确认弹窗（编辑套餐时的"改动即重置"
> 提示）同样用 `resetWindowsRawEqual`。

## 前端展示

- 钱包订阅卡 / 我的订阅 `buildLimitRows`：legacy 只渲染 `>0` 的 cycle/week/month 行；
  动态逐窗口渲染 `used/total`。封顶窗口（后端状态 `next_reset_at==0 && cycle_start_at>0`）
  优先按后端状态标「Total cap」；无订阅状态（套餐目录、购买/续费弹窗）才用 `isCapWindow`
  时长估算（月≈30 天、`duration > validity`，与后端 `next > end` 对齐）。
- 目录/弹窗窗口摘要：`{{amount}} every {{period}}`（普通窗口）/ `{{amount}} total`（封顶）。
- 行 key 用 `unit-value`，多个封顶窗口不会 key 冲突。

## 钱包「订阅抵扣」统计口径

钱包余额卡「订阅抵扣」= 生效订阅 `month_used` 之和（自然日历月口径）。

- **legacy**：`month_used` 是真实月度上限计数，预扣累加、结算修正、月边界清零。
- **动态窗口**：`month_used` **不是**上限（上限只来自窗口），但同样维护为展示统计——
  预扣累加、结算差额修正、自然月边界清零，与 legacy 口径一致。

> 注：系统在每条消费日志的 `other.billing_source` 上记录了该笔是 `wallet` 还是
> `subscription`（service/log_info_generate.go），但它是 JSON 字段、非日志表列，暂未用于
> 统计。若将来要做"按来源出报表"，需要把 `billing_source` 提升为日志表真列（注意
> ClickHouse 等日志库的兼容），属另一件事。

## 代码落点

| 职责 | 位置 |
|---|---|
| 模型判定/剩余额度 | `model/subscription.go`：`ResetWindows()`、`subscriptionRemaining`、`subscriptionRemainingWindows` |
| 窗口状态机 | `model/subscription.go`：`advanceSubscriptionWindows`、`advanceWindowState`、`advanceDynamicWindows`、`calcWindowNextReset` |
| 预扣/结算/退款 | `model/subscription.go`：`PreConsumeUserSubscription`、`PostConsumeUserSubscriptionDelta`、`RefundSubscriptionPreConsume` |
| 续费/创建/过期 | `model/subscription.go`：`RenewSubscriptionTx`、`CreateUserSubscriptionFromPlanTx`、`ExpireDueSubscriptions` |
| 套餐校验/互斥 | `controller/subscription.go`：`validateResetWindows`、`validatePlanResetWindows`、`resetWindowsConflictsWithLegacy` |
| 切换（改动即重置） | `controller/subscription.go`（`AdminUpdateSubscriptionPlan`）+ `model/subscription.go`：`ApplyPlanWindowsToActiveSubscriptions`、`ApplyPlanLegacyToActiveSubscriptions`、`ResetWindowsEqual` |
| 前端限额行/摘要 | `web/src/features/wallet/lib/subscription-limits.ts`、`web/src/features/subscriptions/lib/format.ts` |
| 订阅抵扣统计 | 后端维护 `month_used`（`model/subscription.go`）；前端 `web/src/features/wallet/components/wallet-stats-card.tsx` |
