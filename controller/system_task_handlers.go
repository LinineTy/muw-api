package controller

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// RegisterScheduledSystemTasks wires the periodic channel test, upstream model
// update, async task polling (Midjourney / Suno / video), and LinuxDo trust
// refresh jobs into the system task framework so a DB lease dedups execution
// across multiple master instances and each run is recorded as one task row.
// Call this before service.StartSystemTaskRunner.
func RegisterScheduledSystemTasks() {
	service.RegisterSystemTaskHandler(channelTestHandler{})
	service.RegisterSystemTaskHandler(modelUpdateHandler{})
	service.RegisterSystemTaskHandler(midjourneyPollHandler{})
	service.RegisterSystemTaskHandler(asyncTaskPollHandler{})
	service.RegisterSystemTaskHandler(linuxDoTrustRefreshHandler{})
	service.RegisterSystemTaskHandler(creditScoreRecoverHandler{})
	service.RegisterSystemTaskHandler(conversationCleanupHandler{})
	// creditMarkerAnalysisHandler 非定时调度：由写错误日志路径 / 手动按钮 / 强制重跑
	// 通过 service.EnqueueSystemTask 触发。
	service.RegisterSystemTaskHandler(creditMarkerAnalysisHandler{})
	service.RegisterSystemTaskHandler(creditAuditCleanupHandler{})
	// inviteTrapGraceHandler 到期处置：钓鱼邀请码宽限期已过、仍未用有效邀请码激活的账号
	// 统一停用。每分钟一次，保证「超时」最多晚一分钟生效。
	service.RegisterSystemTaskHandler(inviteTrapGraceHandler{})
	// creditScoreResetHandler 非定时调度：由风控中心设置页「重置所有用户为当前满分」按钮
	// 通过 service.EnqueueSystemTask 触发。
	service.RegisterSystemTaskHandler(creditScoreResetHandler{})
}

// channelTestHandler runs the scheduled "test all channels" job. Enablement and
// cadence still come from the monitor settings; only the execution path moved
// into the system task runner.
type channelTestHandler struct{}

func (channelTestHandler) Type() string { return model.SystemTaskTypeChannelTest }

func (channelTestHandler) Enabled() bool {
	return operation_setting.GetMonitorSetting().AutoTestChannelEnabled
}

func (channelTestHandler) Interval() time.Duration {
	minutes := operation_setting.GetMonitorSetting().AutoTestChannelMinutes
	if minutes <= 0 {
		minutes = 10
	}
	return time.Duration(minutes * float64(time.Minute))
}

func (channelTestHandler) NewPayload() any { return nil }

// channelTestTaskPayload controls one channel_test run. A nil/empty payload is a
// scheduled run, which uses the configured monitor ChannelTestMode and does not
// notify. A manual "test all channels" trigger sets Mode=scheduled_all and
// Notify=true to reproduce the legacy manual behavior (test every channel and
// notify root on completion).
type channelTestTaskPayload struct {
	Mode   string `json:"mode,omitempty"`
	Notify bool   `json:"notify,omitempty"`
}

func (channelTestHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := channelTestTaskPayload{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	summary, err := runChannelTestTask(ctx, payload.Mode, payload.Notify, service.NewSystemTaskProgressReporter(task, runnerID))
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// modelUpdateHandler runs the scheduled upstream model update detection job.
type modelUpdateHandler struct{}

func (modelUpdateHandler) Type() string { return model.SystemTaskTypeModelUpdate }

func (modelUpdateHandler) Enabled() bool {
	return common.GetEnvOrDefaultBool("CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_ENABLED", true)
}

func (modelUpdateHandler) Interval() time.Duration {
	intervalMinutes := common.GetEnvOrDefault(
		"CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_INTERVAL_MINUTES",
		channelUpstreamModelUpdateTaskDefaultIntervalMinutes,
	)
	if intervalMinutes < 1 {
		intervalMinutes = channelUpstreamModelUpdateTaskDefaultIntervalMinutes
	}
	return time.Duration(intervalMinutes) * time.Minute
}

func (modelUpdateHandler) NewPayload() any { return nil }

// modelUpdateTaskPayload controls one model_update run. A scheduled run
// (Manual=false) respects the per-channel minimum check interval and may
// auto-apply detected models when a channel has auto-sync enabled. A manual
// "detect all" trigger sets Manual=true to reproduce the legacy detect-all
// semantics: force a re-check regardless of the interval and never auto-apply,
// so the admin reviews and applies changes explicitly.
type modelUpdateTaskPayload struct {
	Manual bool `json:"manual,omitempty"`
}

func (modelUpdateHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := modelUpdateTaskPayload{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	summary := runChannelUpstreamModelUpdateTaskOnce(ctx, payload.Manual, !payload.Manual, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// midjourneyPollHandler runs one Midjourney polling pass per scheduled run.
// Enabled() folds the "are there unfinished tasks?" check into enablement so the
// scheduler creates no row when the system is idle; only when at least one
// Midjourney task is in progress does a row get scheduled.
type midjourneyPollHandler struct{}

func (midjourneyPollHandler) Type() string { return model.SystemTaskTypeMidjourneyPoll }

func (midjourneyPollHandler) Enabled() bool {
	return constant.UpdateTask && model.HasUnfinishedMidjourneyTasks()
}

func (midjourneyPollHandler) Interval() time.Duration { return 15 * time.Second }

func (midjourneyPollHandler) NewPayload() any { return nil }

func (midjourneyPollHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary := runMidjourneyTaskUpdateOnce(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// asyncTaskPollHandler runs one async-task (Suno/video) polling pass per
// scheduled run. Like midjourneyPollHandler, Enabled() folds in the unfinished
// task existence check so an idle system schedules no rows.
type asyncTaskPollHandler struct{}

func (asyncTaskPollHandler) Type() string { return model.SystemTaskTypeAsyncTaskPoll }

func (asyncTaskPollHandler) Enabled() bool {
	return constant.UpdateTask && model.HasUnfinishedSyncTasks()
}

func (asyncTaskPollHandler) Interval() time.Duration { return 15 * time.Second }

func (asyncTaskPollHandler) NewPayload() any { return nil }

func (asyncTaskPollHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary := service.RunTaskPollingOnce(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

func finishSystemTaskHandler(task *model.SystemTask, runnerID string, status model.SystemTaskStatus, result any, runErr error) {
	errorMessage := ""
	if runErr != nil {
		errorMessage = runErr.Error()
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, result, errorMessage); err != nil {
		common.SysLog(fmt.Sprintf("system task %s failed to persist result: %v", task.TaskID, err))
	}
}

// linuxDoTrustRefreshHandler periodically syncs the LinuxDo trust level (and
// auto-managed group) for every user that has a stored refresh token, without
// requiring them to re-authorize. Cadence and enablement come from the admin
// settings (LinuxDoRefreshEnabled / LinuxDoRefreshIntervalHours).
type linuxDoTrustRefreshHandler struct{}

func (linuxDoTrustRefreshHandler) Type() string { return model.SystemTaskTypeLinuxDoTrustRefresh }

func (linuxDoTrustRefreshHandler) Enabled() bool {
	return common.LinuxDoRefreshEnabled && common.LinuxDOOAuthEnabled
}

func (linuxDoTrustRefreshHandler) Interval() time.Duration {
	hours := common.LinuxDoRefreshIntervalHours
	if hours < 1 {
		hours = 1
	}
	return time.Duration(hours) * time.Hour
}

func (linuxDoTrustRefreshHandler) NewPayload() any { return nil }

func (linuxDoTrustRefreshHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary, err := refreshLinuxDOTrustLevels(ctx, task, runnerID)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// refreshLinuxDOTrustLevels iterates over all LinuxDo users that have a stored
// refresh token and syncs each one's trust level + group. Users whose refresh
// token was revoked/expired (or that fail transiently) are logged and skipped —
// they recover on their next interactive login or manual refresh.
func refreshLinuxDOTrustLevels(ctx context.Context, task *model.SystemTask, runnerID string) (map[string]int, error) {
	users, err := model.ListLinuxDOUsersForRefresh()
	if err != nil {
		return nil, fmt.Errorf("list linuxdo users: %w", err)
	}
	if len(users) == 0 {
		return map[string]int{"total": 0, "refreshed": 0, "skipped": 0}, nil
	}

	report := service.NewSystemTaskProgressReporter(task, runnerID)
	provider := &oauth.LinuxDOProvider{}

	refreshed, skipped := 0, 0
	for i, user := range users {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		if err := refreshOneLinuxDOUser(ctx, provider, user); err != nil {
			skipped++
			if errors.Is(err, oauth.ErrLinuxDOTokenInvalid) {
				common.SysLog(fmt.Sprintf("[LinuxDoRefresh] user %d refresh token invalid, skipping", user.Id))
			} else {
				common.SysLog(fmt.Sprintf("[LinuxDoRefresh] user %d refresh failed: %s", user.Id, err.Error()))
			}
		} else {
			refreshed++
		}
		report(i+1, len(users))
	}

	return map[string]int{"total": len(users), "refreshed": refreshed, "skipped": skipped}, nil
}

// refreshOneLinuxDOUser exchanges the stored refresh token for a fresh access
// token, pulls the current LinuxDo profile, and persists the new level/group
// along with the rotated tokens.
func refreshOneLinuxDOUser(ctx context.Context, provider *oauth.LinuxDOProvider, user *model.User) error {
	_, refresh, _, err := model.LoadLinuxDOTokens(user.Id)
	if err != nil {
		return err
	}
	if refresh == "" {
		return nil
	}

	token, err := provider.RefreshAccessToken(ctx, refresh)
	if err != nil {
		return err
	}
	oauthUser, err := provider.GetUserInfoForRefresh(ctx, token)
	if err != nil {
		return err
	}

	applyLinuxDOProfile(user, oauthUser, false)

	// The refresh response may not rotate the refresh token; keep the existing
	// one in that case so the next silent refresh keeps working.
	newRefresh := token.RefreshToken
	if newRefresh == "" {
		newRefresh = refresh
	}
	expiresAt := time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).Unix()
	if err := model.PersistLinuxDOTokens(user.Id, token.AccessToken, newRefresh, expiresAt); err != nil {
		return err
	}
	return nil
}

// creditScoreRecoverHandler 被动恢复：无违规 24h 的用户 +RecoverPerDay（clamp 满分级）。
// 恢复记录写 credit_score_logs，24h 内有恢复的用户不会再被选中。
type creditScoreRecoverHandler struct{}

func (creditScoreRecoverHandler) Type() string { return model.SystemTaskTypeCreditScoreRecover }

func (creditScoreRecoverHandler) Enabled() bool {
	s := operation_setting.GetCreditScoreSetting()
	return s.Enabled && s.RecoverEnabled
}

func (creditScoreRecoverHandler) Interval() time.Duration { return time.Hour }

func (creditScoreRecoverHandler) NewPayload() any { return nil }

func (creditScoreRecoverHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary, err := runCreditScoreRecover(ctx, task, runnerID)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

func runCreditScoreRecover(ctx context.Context, task *model.SystemTask, runnerID string) (map[string]int, error) {
	setting := operation_setting.GetCreditScoreSetting()
	if !setting.Enabled || !setting.RecoverEnabled || setting.RecoverPerDay <= 0 {
		return map[string]int{"recovered": 0}, nil
	}
	recovered := 0
	for batch := 0; batch < 200; batch++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		users, err := model.ListUsersEligibleForRecover(setting.FullScore, time.Now().Unix()-24*3600, 100)
		if err != nil {
			return nil, fmt.Errorf("list eligible users: %w", err)
		}
		if len(users) == 0 {
			break
		}
		for _, user := range users {
			log := &model.CreditScoreLog{Source: service.CreditSourcePassiveRecover, Reason: "无违规被动恢复"}
			newBalance, err := model.ApplyCreditScoreDelta(user.Id, setting.RecoverPerDay, setting.FullScore, log)
			if err != nil {
				common.SysLog(fmt.Sprintf("[CreditRecover] user %d recover failed: %s", user.Id, err.Error()))
				continue
			}
			if err := model.UpdateUserCreditScoreCache(user.Id, newBalance); err != nil {
				_ = model.InvalidateUserCache(user.Id)
			}
			recovered++
		}
	}
	return map[string]int{"recovered": recovered}, nil
}

// conversationCleanupHandler 按 TTLDays 清理过期对话记录。
type conversationCleanupHandler struct{}

func (conversationCleanupHandler) Type() string { return model.SystemTaskTypeConversationCleanup }

func (conversationCleanupHandler) Enabled() bool {
	return operation_setting.GetConversationRetentionSetting().Enabled
}

func (conversationCleanupHandler) Interval() time.Duration { return 6 * time.Hour }

func (conversationCleanupHandler) NewPayload() any { return nil }

func (conversationCleanupHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary, err := runConversationRecordCleanup(ctx, task, runnerID)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

func runConversationRecordCleanup(ctx context.Context, task *model.SystemTask, runnerID string) (map[string]int, error) {
	setting := operation_setting.GetConversationRetentionSetting()
	if !setting.Enabled {
		return map[string]int{"deleted": 0}, nil
	}
	deleted := 0
	// TTL：按保留天数删过期记录。
	if setting.TTLDays > 0 {
		target := time.Now().AddDate(0, 0, -setting.TTLDays).Unix()
		for {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			batch, err := model.DeleteOldConversationRecordsBatch(ctx, target, 200)
			if err != nil {
				return nil, fmt.Errorf("delete old conversation records: %w", err)
			}
			deleted += int(batch)
			if batch == 0 {
				break
			}
		}
	}
	// 总存量上限：超出 MaxTotalBytes 后滚动删最老记录，直到低于上限。
	if setting.MaxTotalBytes > 0 {
		for batch := 0; batch < 200; batch++ {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			total, err := model.SumConversationSize(ctx)
			if err != nil {
				return nil, fmt.Errorf("sum conversation size: %w", err)
			}
			if total <= setting.MaxTotalBytes {
				break
			}
			n, err := model.DeleteOldestConversationRecordsBatch(ctx, 200)
			if err != nil {
				return nil, fmt.Errorf("delete oldest conversation records: %w", err)
			}
			deleted += int(n)
			if n == 0 {
				break
			}
		}
	}
	return map[string]int{"deleted": deleted}, nil
}

// creditMarkerAnalysisHandler 违规标记词 AI 分析任务（非定时调度）。由写错误日志路径的
// 定量触发（service.MaybeTriggerMarkerAnalysis）、手动「分析」按钮、强制「全量重跑」
// （force）入队。Run 走统一水位线管道：从水位线按 id 升序分批全量喂入，批间推进水位线。
type creditMarkerAnalysisHandler struct{}

func (creditMarkerAnalysisHandler) Type() string { return model.SystemTaskTypeCreditMarkerAnalysis }

func (creditMarkerAnalysisHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := service.MarkerAnalysisTaskPayload{}
	_ = task.DecodePayload(&payload)
	triggeredBy := payload.TriggeredBy
	if triggeredBy == "" {
		triggeredBy = "manual"
	}
	summary, err := service.AnalyzeMarkerBacklog(ctx, triggeredBy, payload.Force, func(s service.MarkerAnalysisTaskState) {
		_ = model.UpdateSystemTaskState(task.TaskID, runnerID, s)
	})
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
	} else {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
	}
	// 自续：运行期间新增/失败未推进导致积压仍超阈值时，节流允许则再触发下一轮。
	service.MaybeTriggerMarkerAnalysis(ctx)
}

// creditScoreResetHandler 全站信誉分重置（非定时调度）。由风控中心设置页「重置所有用户
// 为当前满分」按钮触发：把所有用户 credit_score 归一到当前 full_score，逐用户落审计明细，
// 并清除仍在冷却期的保证书。带进度。
type creditScoreResetHandler struct{}

func (creditScoreResetHandler) Type() string { return model.SystemTaskTypeCreditScoreReset }

func (creditScoreResetHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary, err := service.RunCreditScoreReset(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// creditAuditCleanupHandler 清理信誉分审计类表：扣分明细保留 180 天（审计证据，保留窗口
// 长一点），标记词建议（仅已处理）与分析运行日志保留 90 天；已分析日志标记与分析候选只
// 做"别重复喂"去重、不承载审计价值，保留 30 天即可。pending 建议永不删。
type creditAuditCleanupHandler struct{}

const (
	creditScoreLogRetentionDays = 180
	creditMarkerRetentionDays   = 90
	// creditMarkerAnalyzedLogRetentionDays 已分析日志标记/分析候选的去重窗口。它们唯一
	// 的作用是"这条日志别再喂模型"，不承载审计价值；错误日志本身由管理员手动清理、无固定
	// 保留期，标记比日志活得久就是浪费行数——GetAnalyzedErrorLogIds 每次把最多 50 万行
	// 载入内存（定量轮询每 30 分钟一次），短窗口显著降低内存与磁盘。30 天覆盖常规分析
	// （24h 窗口）与历史重拉/重析的近期幂等，更早的日志重拉后重新分析反而是期望行为。
	creditMarkerAnalyzedLogRetentionDays = 30
)

func (creditAuditCleanupHandler) Type() string { return model.SystemTaskTypeCreditAuditCleanup }

func (creditAuditCleanupHandler) Enabled() bool {
	// 跟随信誉分总开关：功能关闭时三张审计表无新数据，不必每日空转清理。
	return operation_setting.GetCreditScoreSetting().Enabled
}

func (creditAuditCleanupHandler) Interval() time.Duration { return 24 * time.Hour }

func (creditAuditCleanupHandler) NewPayload() any { return nil }

func (creditAuditCleanupHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary, err := runCreditAuditCleanup(ctx)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

func runCreditAuditCleanup(ctx context.Context) (map[string]int, error) {
	deleted := map[string]int{
		"credit_logs":          0,
		"marker_suggestions":   0,
		"marker_analysis_logs": 0,
		"analyzed_logs":        0,
	}
	scoreTarget := time.Now().AddDate(0, 0, -creditScoreLogRetentionDays).Unix()
	n, err := deleteInBatches(ctx, model.DeleteOldCreditScoreLogsBatch, scoreTarget)
	if err != nil {
		return nil, fmt.Errorf("delete old credit score logs: %w", err)
	}
	deleted["credit_logs"] = n

	markerTarget := time.Now().AddDate(0, 0, -creditMarkerRetentionDays).Unix()
	n, err = deleteInBatches(ctx, model.DeleteOldResolvedCreditMarkerSuggestionsBatch, markerTarget)
	if err != nil {
		return nil, fmt.Errorf("delete old marker suggestions: %w", err)
	}
	deleted["marker_suggestions"] = n

	n, err = deleteInBatches(ctx, model.DeleteOldCreditMarkerAnalysisLogsBatch, markerTarget)
	if err != nil {
		return nil, fmt.Errorf("delete old marker analysis logs: %w", err)
	}
	deleted["marker_analysis_logs"] = n

	// 已分析日志标记：只做审计留痕，用更短的去重窗口（分析历史已由水位线承载"处理到哪"）。
	analyzedTarget := time.Now().AddDate(0, 0, -creditMarkerAnalyzedLogRetentionDays).Unix()
	n, err = deleteInBatches(ctx, model.DeleteOldCreditMarkerAnalyzedLogsBatch, analyzedTarget)
	if err != nil {
		return nil, fmt.Errorf("delete old marker analyzed logs: %w", err)
	}
	deleted["analyzed_logs"] = n
	return deleted, nil
}

// deleteInBatches 按批次循环删除直到删光或上下文取消，返回总删除行数。
// 批次上限兜底，防止异常状态下单次任务跑太久。
func deleteInBatches(ctx context.Context, fn func(context.Context, int64, int) (int64, error), target int64) (int, error) {
	total := 0
	for batch := 0; batch < 500; batch++ {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, err := fn(ctx, target, 200)
		if err != nil {
			return total, err
		}
		total += int(n)
		if n == 0 {
			break
		}
	}
	return total, nil
}

// inviteTrapGraceHandler 钓鱼邀请码宽限到期处置（自研）：命中钩子只落一条宽限记录，
// 到期仍未用有效邀请码激活的账号在这里统一停用（status=2 + remark 写封禁原因）。
// 一分钟一次：窗口默认 15 分钟，一分钟粒度足够，也避免用户在"能登录但进不去"的状态久挂。
type inviteTrapGraceHandler struct{}

func (inviteTrapGraceHandler) Type() string { return model.SystemTaskTypeInviteTrapGrace }

func (inviteTrapGraceHandler) Enabled() bool { return true }

func (inviteTrapGraceHandler) Interval() time.Duration { return time.Minute }

func (inviteTrapGraceHandler) NewPayload() any { return nil }

func (inviteTrapGraceHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary, err := runInviteTrapGraceExpiry(ctx)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
	// 本任务每分钟一行，自行清理历史（只留最近 20 条终态行），否则 system_tasks 稳定增长。
	if _, err := model.PruneSystemTaskHistoryByType(model.SystemTaskTypeInviteTrapGrace, 20); err != nil {
		common.SysLog("[InviteTrap] prune system task history failed: " + err.Error())
	}
	// 同一条任务顺手清理过期的人机校验挑战（内存池，5 分钟 TTL，激活页与登录/注册共用）：
	// 不为它单独加一个任务类型。
	if removed := model.PrunePoWChallenges(); removed > 0 {
		common.SysLog(fmt.Sprintf("[InviteTrap] pruned %d expired pow challenges", removed))
	}
}

// runInviteTrapGraceExpiry 扫描已到期未结清的宽限记录并停用账号。
// 停用成功才结清记录：失败的行留到下一分钟重试（避免误停或漏停后无人补）。
func runInviteTrapGraceExpiry(ctx context.Context) (map[string]int, error) {
	now := common.GetTimestamp()
	disabled, failed := 0, 0
	for batch := 0; batch < 200; batch++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		records, err := model.ListExpiredInviteTrapGraces(now, 100)
		if err != nil {
			return nil, fmt.Errorf("list expired invite trap graces: %w", err)
		}
		if len(records) == 0 {
			break
		}
		progressed := false
		for _, record := range records {
			if err := model.DisableUserByTrap(record.UserId, common.TrapInviteCodeBanReason); err != nil {
				failed++
				common.SysLog(fmt.Sprintf("[InviteTrap] disable user %d failed: %s", record.UserId, err.Error()))
				continue
			}
			if err := model.ResolveInviteTrapGrace(record.UserId, model.InviteTrapGraceReasonExpired); err != nil {
				common.SysLog(fmt.Sprintf("[InviteTrap] resolve grace for user %d failed: %s", record.UserId, err.Error()))
			}
			model.RecordLog(record.UserId, model.LogTypeSystem, "钓鱼码宽限期已过，账号已停用")
			model.RecordOperationAuditLog(record.UserId, common.RoleCommonUser, "钓鱼码宽限期已过，账号已停用",
				record.Ip, "invite.trap_expired", map[string]any{
					"code_id":     record.RedemptionId,
					"hit_count":   record.HitCount,
					"expire_at":   record.ExpireAt,
					"resolved_by": "system_task",
				}, nil, nil)
			disabled++
			progressed = true
		}
		if !progressed || len(records) < 100 {
			break
		}
	}
	return map[string]int{"disabled": disabled, "failed": failed}, nil
}
