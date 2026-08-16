package service

import (
	"context"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// CreditScoreResetStatus 信誉分重置任务状态：是否在跑（含进度）、最近一次结果/错误。
type CreditScoreResetStatus struct {
	Running bool                     `json:"running"`
	State   *SystemTaskProgress      `json:"state,omitempty"`
	Last    *CreditScoreResetLastRun `json:"last,omitempty"`
}

// CreditScoreResetLastRun 最近一次重置的结果。
type CreditScoreResetLastRun struct {
	Reset       int    `json:"reset"`
	Skipped     int    `json:"skipped"`
	Failed      int    `json:"failed"`
	ClearedLogs int    `json:"cleared_logs"`
	Error       string `json:"error"`
	FinishedAt  int64  `json:"finished_at"`
}

// creditScoreResetBatchSize 重置每批处理的用户数（按 id 升序游标翻页）。
const creditScoreResetBatchSize = 200

// GetCreditScoreResetStatus 组装重置卡片状态：是否在跑（含进度）、最近一次结果/错误。
func GetCreditScoreResetStatus(ctx context.Context) (*CreditScoreResetStatus, error) {
	status := &CreditScoreResetStatus{}
	if task, err := model.GetActiveSystemTask(model.SystemTaskTypeCreditScoreReset); err != nil {
		return nil, err
	} else if task != nil {
		status.Running = true
		st := &SystemTaskProgress{}
		_ = task.DecodeState(st)
		status.State = st
	}
	if last, err := model.GetLatestSystemTask(model.SystemTaskTypeCreditScoreReset); err != nil {
		return nil, err
	} else if last != nil && (last.Status == model.SystemTaskStatusSucceeded || last.Status == model.SystemTaskStatusFailed) {
		status.Last = &CreditScoreResetLastRun{FinishedAt: last.UpdatedAt, Error: last.Error}
		if last.Status == model.SystemTaskStatusSucceeded {
			var result map[string]int
			if err := last.DecodeResult(&result); err == nil {
				status.Last.Reset = result["reset"]
				status.Last.Skipped = result["skipped"]
				status.Last.Failed = result["failed"]
				status.Last.ClearedLogs = result["cleared_logs"]
			}
		}
	}
	return status, nil
}

// RunCreditScoreReset 全站信誉分重置 = 信用分体系从头开始：
//  1. 清空全部信用分明细（旧扣分/恢复/保证书/重置记录一并删除）；
//  2. 把所有未软删除用户的 credit_score 归一到当前 full_score，已满分的跳过；
//  3. 每个被重置的用户落一条 source=full_score_reset 记录作为新起点（保证书冷却因旧
//     pledge 记录被清空而自然失效，无需单独处理）。
//
// 第 1 步清空发生在重置写入之前，所以新落的重置记录不会被误删。分数写入走
// ApplyCreditScoreDelta（行锁串行化并发扣分 + clamp 到 [0, full_score]）。
// onProgress 每批回调 (processed, total)（通常由 NewSystemTaskProgressReporter 生成，
// 可为 nil）。返回结果计数。
func RunCreditScoreReset(ctx context.Context, onProgress func(processed, total int)) (map[string]int, error) {
	setting := operation_setting.GetCreditScoreSetting()
	fullScore := setting.FullScore
	if fullScore <= 0 {
		return nil, fmt.Errorf("full score must be positive")
	}

	clearedLogs, err := model.DeleteAllCreditScoreLogs()
	if err != nil {
		return nil, fmt.Errorf("clear credit score logs: %w", err)
	}

	total, err := model.CountAllUsers()
	if err != nil {
		return nil, fmt.Errorf("count users: %w", err)
	}

	reset, skipped, failed := 0, 0, 0
	processed := 0
	lastID := 0
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		users, err := model.ListUsersByIDBatch(lastID, creditScoreResetBatchSize)
		if err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}
		if len(users) == 0 {
			break
		}
		for _, user := range users {
			if user.CreditScore == fullScore {
				skipped++
				continue
			}
			log := &model.CreditScoreLog{
				Source: CreditSourceFullScoreReset,
				Reason: fmt.Sprintf("管理员调整满分，全站信誉分重置为新满分 %d", fullScore),
			}
			newBalance, err := model.ApplyCreditScoreDelta(user.Id, fullScore-user.CreditScore, fullScore, log)
			if err != nil {
				failed++
				common.SysLog(fmt.Sprintf("credit score reset: user %d failed: %s", user.Id, err.Error()))
				continue
			}
			if err := model.UpdateUserCreditScoreCache(user.Id, newBalance); err != nil {
				_ = model.InvalidateUserCache(user.Id)
			}
			reset++
		}
		processed += len(users)
		lastID = users[len(users)-1].Id
		if onProgress != nil {
			onProgress(processed, int(total))
		}
	}

	return map[string]int{
		"reset":        reset,
		"skipped":      skipped,
		"failed":       failed,
		"cleared_logs": int(clearedLogs),
	}, nil
}
