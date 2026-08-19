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
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewSubscriptionSortOptions(t *testing.T) {
	tests := []struct {
		name      string
		sortBy    string
		sortOrder string
		wantBy    string
		wantDesc  bool
	}{
		{name: "empty falls back", sortBy: "", sortOrder: "", wantBy: "end_time", wantDesc: true},
		{name: "unknown column falls back", sortBy: "usage", sortOrder: "desc", wantBy: "end_time", wantDesc: true},
		{name: "valid asc", sortBy: "start_time", sortOrder: "asc", wantBy: "start_time", wantDesc: false},
		{name: "valid desc", sortBy: "status", sortOrder: "desc", wantBy: "status", wantDesc: true},
		{name: "invalid order becomes desc", sortBy: "id", sortOrder: "sideways", wantBy: "id", wantDesc: true},
		{name: "case insensitive", sortBy: "END_TIME", sortOrder: "ASC", wantBy: "end_time", wantDesc: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NewSubscriptionSortOptions(tt.sortBy, tt.sortOrder)
			assert.Equal(t, tt.wantBy, got.SortBy)
			assert.Equal(t, tt.wantDesc, got.SortOrder != "asc")
		})
	}
}

// TestGetAllSubscriptionsByAdminSorting verifies the admin list honors server-side
// sort options and falls back to end_time desc for unknown/absent input. The
// keyword is the exact numeric user id so the result set is isolated to the
// rows seeded here regardless of other tests.
func TestGetAllSubscriptionsByAdminSorting(t *testing.T) {
	now := GetDBTimestamp()
	const userId = 99211

	rows := []struct {
		id        int
		startTime int64
		endTime   int64
	}{
		{id: 7951, startTime: now - 300, endTime: now + 100},
		{id: 7952, startTime: now - 100, endTime: now + 300},
		{id: 7953, startTime: now - 200, endTime: now + 200},
	}
	for _, r := range rows {
		seedQuotaSub(t, r.id, &UserSubscription{
			UserId:    userId,
			PlanId:    1,
			Status:    "active",
			StartTime: r.startTime,
			EndTime:   r.endTime,
		})
	}

	run := func(sortBy, sortOrder string, want []int) {
		t.Helper()
		items, total, err := GetAllSubscriptionsByAdmin(
			"", strconv.Itoa(userId), 0, 0, 20,
			NewSubscriptionSortOptions(sortBy, sortOrder),
		)
		require.NoError(t, err)
		require.Equal(t, int64(3), total)
		got := make([]int, len(items))
		for i, item := range items {
			got[i] = item.Subscription.Id
		}
		assert.Equal(t, want, got)
	}

	run("end_time", "desc", []int{7952, 7953, 7951})
	run("start_time", "asc", []int{7951, 7953, 7952})
	run("id", "asc", []int{7951, 7952, 7953})
	run("bogus", "", []int{7952, 7953, 7951})
}
