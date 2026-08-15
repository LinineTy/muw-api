# 风控体系设计方案（讨论稿 / 未实现）

> 状态：**讨论中，未开工**。本文档是 2026-08-15 讨论的记录，供后续会话接着讨论或实施。
> 关联代码库落点见文末「代码库 hook 点」。

## 背景

日志里大量出现上游返回"检测到不当输入内容"，但：
- 看不到用户发了什么（消费日志不存消息内容）；
- 违规没有惩罚/积累（只有已有的违规扣费 `service/violation_fee.go`，按 Grok 配置扣一笔钱）；
- 拦截只有 AC 自动机关键词（`controller/relay.go:171`，命中即 400，不扣分）。

## 三件套（按实施难度排序）

1. **信誉分体系**（★☆☆，最先做）：用户信用分，违规扣分，低分限用/冻结，可恢复。
2. **对话记录留存**（★★☆）：把请求消息内容存下来供管理员查看，图片不存。
3. **前置审查**（★★★，最后做）：转发前对内容做强审查（本地关键词 → 语义审查），先观察后拦截。

## 信誉分设计（王者荣耀 650 分制灵感）

```
满分 650，红线 500

扣分（初始值，可调）：
  上游返回违规标记   −5   （实害：内容已发出）
  前置审查命中       −3   （已拦截，无实害）
  本地关键词命中     −1   （AC 误伤多，权重最低）
  24h 内重复同类违规：第 2 次 ×2、第 3 次 ×3（封顶 ×3）
  每日扣分上限       −15  （防上游故障 / 误伤连坐）

恢复：
  被动：无违规自然增长 +5/天（满 650 停）。惰性计算：
        last_violation_at + last_recover_at 两个时间戳，请求时现算，
        不需要定时任务。
  主动：保证书（阅读 + 勾选同意）或答题 +10~15 分，冷却 7 天
        （last_pledge_at）。v1 只做保证书，答题后置。

分档：
  [650,600)  正常，无感
  [600,550)  观察：风控中心面板黄标预警，不限制
  [550,500)  限流/降权：降级到隔离分组或低优先级，API 正常但提示
  <500       冻结：API 403（credit_score_insufficient + recover_url），
             必须完成保证书/答题才恢复部分分数
```

### 必须配套

- **审计明细**：每次扣分落一条记录（谁/为什么/哪条 request_id/扣几分），面板能解释"为什么分低"，与对话留存串成证据链。
- **手动恢复**：管理端一键恢复/手动扣分，第一版就有（误判出口）。
- **分级处置而非一步封死**：观察 → 警告 → 降权 → 冻结。
- 每笔扣分要防并发 + 失效用户缓存（`UserBase` 缓存，含 Status；若展示信用分需升 `userCacheSchemaVersion`）。

### 触发点（三处，都在 controller/relay.go，拿得到 relayInfo.UserId）

1. 上游违规标记：复用 `service/violation_fee.go` 的判定（`HasCSAMViolationMarker`），在 `ChargeViolationFeeIfNeeded`（`controller/relay.go:205-214`）旁边并列扣分。
2. 本地关键词命中：`controller/relay.go:172`。
3. 前置审查命中（将来）。

## 对话记录留存

- **结论：新建独立表 `conversation_records`（主库，AutoMigrate 建表），不用 JSON 文件。**
- 理由：生产是 Docker 容器，容器盘临时、不挂 volume 一重启就丢；并发写文件要自己加锁；SQL 按 user/token/时间查是白送的能力。
- 每行挂 `request_id` / `user_id` / `token_id` 关联回消费日志。
- 图片不存：启用视觉兜底后图片已被替换为文字描述，存描述文本；未启用兜底时只存 URL/摘要/hash，不存 base64 正文。
- 写入点：`service/text_quota.go:526`（PostTextConsumeQuota，写消费日志处，`relayInfo.Request` 还在）。
- 可见性：内容塞 `admin_info` 或独立接口，普通用户不暴露（照 `model/log.go:116-132 formatUserLogs` 剥离模式）。
- 清理：照 `DeleteOldLogBatch` 按 created_at TTL。
- 新表走 `model/schema_migration.go` 迁移（升 `CurrentSchemaVersion` + noop/回填占位）。

## 前置审查

- hook 点：`controller/relay.go` 的 `Relay()` 是总闸，所有格式（OpenAI/Claude/Gemini/Responses/图片/音频/embeddings/realtime）都过。
- 现有敏感检查在 `relay.go:171`，位于计价（188）/预扣（199）之前 → 审查放这里被拦的请求零计费。
- 模式：本地 AC 字典先挡（已有）→ 不确定的调语义审查。语义审查走本网关自己的审查模型：照 `controller/vision_fallback.go:318-397 describeImage` 的"isolated subCtx + 子请求走完整 Relay 管线"样板，代码放根模块 `service/`（relaykit 独立约束不受影响）。
- 外部 API（阿里云安全护栏 / 腾讯天御 / OpenAI moderation）作为可选项。
- 阶段：先"仅观察"（只落库不拦截）积累数据，再切拦截。

## 与视觉兜底的冲突（重点）

- 顺序：`applyVisionFallback`（`controller/relay.go:155`）在敏感检查之前 → 审查看到的是**图片描述文本**而非图片本身；图片内容的前置拦截本质上做不到。
- 子请求连坐：视觉子请求走同一个 `Relay()`（`vision_fallback.go:373`），用户身份共享 → 审查/留存/扣分都会连坐视觉子请求。需在 `newSubContext` 加 context key 标记子请求并跳过（目前只有 `ContextKeyVisionFallbackSSEStarted`）。
- 计费：兜底子请求先预扣结算（图片识别费），主请求被审查拦下时该费用已花，需决定是否特殊退款。
- 顺风：兜底把图片换成文字描述 → 正好满足"图片不存"。

## 实施顺序

1. 信誉分（观察版：扣分 + 面板预警 + 手动恢复 + 审计明细）→ 再上被动恢复 → 再上保证书/冻结。
2. 对话留存（独立表 + 写入 + 管理端查看）。
3. 前置审查（AC 增强 + 仅观察 → 语义审查）。

## 代码库 hook 点速查

| 用途 | 位置 |
|---|---|
| 总闸（所有 relay 入口） | `controller/relay.go:85` `Relay()` |
| 现有敏感检查 | `controller/relay.go:171-178` |
| 违规扣费（上游标记） | `service/violation_fee.go`、挂载 `controller/relay.go:205-214` |
| 消费日志写入 | `service/text_quota.go:526` → `model/log.go:357 RecordConsumeLog` |
| 请求内容 | `relay/common/relay_info.go:165` `relayInfo.Request` |
| 用户表加列迁移 | `model/schema_migration.go:45`（升版本 + noop 占位）/ `model/main.go:557`（幂等加列） |
| 用户禁用检查链 | `middleware/auth.go:51-54`、`:450-454`（复用 Status） |
| 自动分组（降权参照） | `controller/oauth.go:611-642` LinuxDO 信任等级 |
| 定时任务（如需要） | `controller/system_task_handlers.go:172-197` |
| 视觉兜底 | `controller/vision_fallback.go`（子请求样板 :318-397） |
| 前端设置页模式 | `web/src/features/system-settings`（visual-fallback-section 作样板） |
| 消费日志详情弹窗 | `web/src/features/usage-logs/components/dialogs/details-dialog.tsx` |

## 待定 / 待讨论

- 分值和分档的最终数值（上面是草案）。
- 每日扣分上限、重复违规倍率窗口。
- 留存存全部还是只存命中审查/违规的。
- 审查用外部 API 还是自建审查模型。
- 是否做答题（题库）还是只做保证书。
