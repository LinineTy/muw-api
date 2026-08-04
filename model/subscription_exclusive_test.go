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
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestSubscriptionEffectiveGroup 保护互斥组的「有效组」判定：订阅行上的快照优先；
// 快照为空（互斥组配置前创建/分配的订阅、或直接改库插入的行）时回退到套餐当前
// 的互斥组，保证存量数据仍能被正确检测为互斥并展示升降级入口。
func TestSubscriptionEffectiveGroup(t *testing.T) {
	cases := []struct {
		name string
		sub  *UserSubscription
		plan *SubscriptionPlan
		want string
	}{
		{"nil subscription", nil, &SubscriptionPlan{ExclusiveGroup: "g"}, ""},
		{"snapshot wins", &UserSubscription{ExclusiveGroup: "snapshot"}, &SubscriptionPlan{ExclusiveGroup: "plan-group"}, "snapshot"},
		{"snapshot whitespace falls back", &UserSubscription{ExclusiveGroup: "  "}, &SubscriptionPlan{ExclusiveGroup: "plan-group"}, "plan-group"},
		{"empty snapshot falls back to plan group", &UserSubscription{}, &SubscriptionPlan{ExclusiveGroup: "plan-group"}, "plan-group"},
		{"nil plan keeps snapshot", &UserSubscription{ExclusiveGroup: "snapshot"}, nil, "snapshot"},
		{"empty snapshot and nil plan", &UserSubscription{}, nil, ""},
		{"empty snapshot and plan without group", &UserSubscription{}, &SubscriptionPlan{}, ""},
		{"plan group whitespace trims to empty", &UserSubscription{}, &SubscriptionPlan{ExclusiveGroup: "   "}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, subscriptionEffectiveGroup(tc.sub, tc.plan))
		})
	}
}
