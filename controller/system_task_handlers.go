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
