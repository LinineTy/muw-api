/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package model

import (
	"fmt"
	"math"
	"sort"
)

// ChannelTestSourceTest marks records produced by scheduled auto-tests and
// manual channel tests (synthetic probes).
const ChannelTestSourceTest = "test"

// ChannelTestSourceUser marks records produced by real user traffic.
const ChannelTestSourceUser = "user"

// ChannelTestRecord persists one channel connectivity probe (scheduled
// auto-test, manual test or real user traffic) so channel/model health can be
// aggregated over time: success rate, latency trend and recent errors.
type ChannelTestRecord struct {
	Id           int    `json:"id"`
	ChannelId    int    `json:"channel_id" gorm:"index"`
	ChannelName  string `json:"channel_name"`
	ModelName    string `json:"model_name" gorm:"index"`
	Success      bool   `json:"success"`
	ResponseTime int    `json:"response_time"` // milliseconds
	ErrorReason  string `json:"error_reason" gorm:"type:text"`
	Source       string `json:"source"`        // ChannelTestSourceTest | ChannelTestSourceUser
	CreatedAt    int64  `json:"created_at" gorm:"autoCreateTime;index"`
}

// TestTrendPoint is one probe in the recent history of a (channel, model) pair.
type TestTrendPoint struct {
	CreatedAt    int64 `json:"created_at"`
	ResponseTime int   `json:"response_time"`
	Success      bool  `json:"success"`
}

// ModelHealthRow aggregates one (channel_id, model_name) pair over a window.
type ModelHealthRow struct {
	ChannelId        int              `json:"channel_id"`
	ChannelName      string           `json:"channel_name"`
	ModelName        string           `json:"model_name"`
	TestCount        int              `json:"test_count"`
	SuccessCount     int              `json:"success_count"`
	SuccessRate      float64          `json:"success_rate"` // 0-100, one decimal
	AvgResponseTime  int              `json:"avg_response_time"`
	LastResponseTime int              `json:"last_response_time"`
	LastTestTime     int64            `json:"last_test_time"`
	LastError        string           `json:"last_error"`
	Trend            []TestTrendPoint `json:"trend"`
	// UserTrafficCount is how many of the TestCount records came from real user
	// traffic (ChannelTestSourceUser) rather than synthetic tests.
	UserTrafficCount int `json:"user_traffic_count"`
}

// channelTestTrendLimit bounds how many recent probes are kept per pair for the
// trend strip. Kept generous so the frontend can render as many fixed-size
// blocks as fit the container width on wide screens.
const channelTestTrendLimit = 200

// AggregateChannelTestRecords groups probe records by (channel_id, model_name)
// and computes per-pair success rate, latency stats, the most recent failure
// reason and a rolling trend. Records may arrive in any order; the function
// sorts chronologically internally. The result order is first-seen.
func AggregateChannelTestRecords(records []ChannelTestRecord) []ModelHealthRow {
	sorted := make([]ChannelTestRecord, len(records))
	copy(sorted, records)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].CreatedAt != sorted[j].CreatedAt {
			return sorted[i].CreatedAt < sorted[j].CreatedAt
		}
		return sorted[i].Id < sorted[j].Id
	})

	type acc struct {
		row        ModelHealthRow
		latencySum int64
		trend      []TestTrendPoint
	}
	groups := make(map[string]*acc)
	var order []string
	for _, r := range sorted {
		key := fmt.Sprintf("%d|%s", r.ChannelId, r.ModelName)
		a, ok := groups[key]
		if !ok {
			a = &acc{row: ModelHealthRow{ChannelId: r.ChannelId, ChannelName: r.ChannelName, ModelName: r.ModelName}}
			groups[key] = a
			order = append(order, key)
		}
		a.row.TestCount++
		if r.Success {
			a.row.SuccessCount++
		}
		if r.Source == ChannelTestSourceUser {
			a.row.UserTrafficCount++
		}
		a.latencySum += int64(r.ResponseTime)
		if r.CreatedAt >= a.row.LastTestTime {
			a.row.LastTestTime = r.CreatedAt
			a.row.LastResponseTime = r.ResponseTime
		}
		if !r.Success && r.ErrorReason != "" {
			a.row.LastError = r.ErrorReason // chronological order → most recent failure wins
		}
		if len(a.trend) < channelTestTrendLimit {
			a.trend = append(a.trend, TestTrendPoint{CreatedAt: r.CreatedAt, ResponseTime: r.ResponseTime, Success: r.Success})
		} else {
			copy(a.trend, a.trend[1:])
			a.trend[len(a.trend)-1] = TestTrendPoint{CreatedAt: r.CreatedAt, ResponseTime: r.ResponseTime, Success: r.Success}
		}
	}

	rows := make([]ModelHealthRow, 0, len(order))
	for _, key := range order {
		a := groups[key]
		if a.row.TestCount > 0 {
			a.row.AvgResponseTime = int(math.Round(float64(a.latencySum) / float64(a.row.TestCount)))
			a.row.SuccessRate = math.Round(float64(a.row.SuccessCount)/float64(a.row.TestCount)*1000) / 10
		}
		a.row.Trend = a.trend
		rows = append(rows, a.row)
	}
	return rows
}

// CollapseToModelLevel folds per-(channel, model) ModelHealthRow aggregation
// into one model-level row per model, dropping channel-scoped details. It backs
// the model health page for non-admin users, who must not learn channel
// identity, per-channel latency or error reasons. ChannelId, ChannelName and
// LastError are therefore always zeroed. Counts sum across channels, average
// response time is test-count weighted, and trends are merged and re-sorted
// chronologically. The result order is first-seen by model name.
func CollapseToModelLevel(rows []ModelHealthRow) []ModelHealthRow {
	type acc struct {
		row        ModelHealthRow
		latencySum int64
	}
	groups := make(map[string]*acc)
	var order []string
	for _, row := range rows {
		a, ok := groups[row.ModelName]
		if !ok {
			a = &acc{row: ModelHealthRow{ModelName: row.ModelName}}
			groups[row.ModelName] = a
			order = append(order, row.ModelName)
		}
		a.row.TestCount += row.TestCount
		a.row.SuccessCount += row.SuccessCount
		a.row.UserTrafficCount += row.UserTrafficCount
		a.latencySum += int64(row.AvgResponseTime) * int64(row.TestCount)
		if row.LastTestTime > a.row.LastTestTime {
			a.row.LastTestTime = row.LastTestTime
			a.row.LastResponseTime = row.LastResponseTime
		}
		a.row.Trend = append(a.row.Trend, row.Trend...)
	}

	out := make([]ModelHealthRow, 0, len(order))
	for _, key := range order {
		a := groups[key]
		if a.row.TestCount > 0 {
			a.row.AvgResponseTime = int(math.Round(float64(a.latencySum) / float64(a.row.TestCount)))
			a.row.SuccessRate = math.Round(float64(a.row.SuccessCount)/float64(a.row.TestCount)*1000) / 10
		}
		sort.SliceStable(a.row.Trend, func(i, j int) bool {
			if a.row.Trend[i].CreatedAt != a.row.Trend[j].CreatedAt {
				return a.row.Trend[i].CreatedAt < a.row.Trend[j].CreatedAt
			}
			return a.row.Trend[i].ResponseTime < a.row.Trend[j].ResponseTime
		})
		out = append(out, a.row)
	}
	return out
}
