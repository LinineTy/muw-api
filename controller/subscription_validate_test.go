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
package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/model"
)

func TestValidateResetWindowsOrdering(t *testing.T) {
	// 时长严格递增（5 小时 → 1 周 → 1 月）→ 合法。
	valid := `[{"unit":"hour","value":5,"limit":10},{"unit":"week","value":1,"limit":50},{"unit":"month","value":1,"limit":200}]`
	require.NoError(t, validateResetWindows(valid))

	// 非递增：第二个窗口（5 小时）比第一个（1 周）短 → 拒绝。
	outOfOrder := `[{"unit":"week","value":1,"limit":50},{"unit":"hour","value":5,"limit":10}]`
	assert.Error(t, validateResetWindows(outOfOrder))

	// 等长：24 小时 与 1 天 时长相同 → 拒绝（严格递增，不允许并列）。
	equalDuration := `[{"unit":"hour","value":24,"limit":10},{"unit":"day","value":1,"limit":50}]`
	assert.Error(t, validateResetWindows(equalDuration))
}

// validatePlanResetWindows 的套餐级护栏：动态窗口是唯一额度模型——空串/空数组拒绝，
// 全 0 窗口 = 无限额度（合法）。
func TestValidatePlanResetWindowsGuards(t *testing.T) {
	// 空串：legacy 已移除，必须至少一个窗口。
	assert.Error(t, validatePlanResetWindows(model.SubscriptionPlan{ResetWindowsRaw: ""}))

	// 空数组 []：非空串但没有任何窗口 → 拒绝。
	assert.Error(t, validatePlanResetWindows(model.SubscriptionPlan{ResetWindowsRaw: "[]"}))

	// 全部窗口 limit=0 = 无限额度 → 合法（动态模型显式无限）。
	allZero := `[{"unit":"hour","value":5,"limit":0},{"unit":"day","value":1,"limit":0}]`
	require.NoError(t, validatePlanResetWindows(model.SubscriptionPlan{ResetWindowsRaw: allZero}))

	// 至少一个 limit>0 → 通过。
	valid := `[{"unit":"hour","value":5,"limit":10},{"unit":"day","value":1,"limit":200}]`
	require.NoError(t, validatePlanResetWindows(model.SubscriptionPlan{ResetWindowsRaw: valid}))
}
