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

// TestUserGroupAllowed 保护「空白名单 = 全部组允许」的语义：空串、纯空白、
// 旧前端遗留的 "[]"、非法 JSON、空 group 都必须放行，只有明确列入白名单的
// 非成员组才拒绝（Bug 1 回归）。
func TestUserGroupAllowed(t *testing.T) {
	cases := []struct {
		name    string
		allowed string
		group   string
		want    bool
	}{
		{"empty whitelist", "", "default", true},
		{"whitespace whitelist", "   ", "default", true},
		{"legacy empty array json", "[]", "default", true},
		{"empty group", `["vip","pro"]`, "", true},
		{"member", `["vip","pro"]`, "pro", true},
		{"non-member rejected", `["vip","pro"]`, "free", false},
		{"malformed json treated unrestricted", "{not-json", "default", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, userGroupAllowed(&SubscriptionPlan{AllowedGroups: tc.allowed}, tc.group))
		})
	}
}

func TestNormalizeSubscriptionPlanAllowedGroups(t *testing.T) {
	assert.Equal(t, "", NormalizeSubscriptionPlanAllowedGroups(""))
	assert.Equal(t, "", NormalizeSubscriptionPlanAllowedGroups("[]"))
	assert.Equal(t, `["vip"]`, NormalizeSubscriptionPlanAllowedGroups(`["vip"]`))
	assert.Equal(t, "{bad", NormalizeSubscriptionPlanAllowedGroups("{bad"))
}
