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

// TestComparePlanTier 保护互斥组档位判定：Priority 优先，同档位回退价格比较。
func TestComparePlanTier(t *testing.T) {
	assert.Equal(t, 1, comparePlanTier(&SubscriptionPlan{Priority: 10}, &SubscriptionPlan{Priority: 5}))
	assert.Equal(t, -1, comparePlanTier(&SubscriptionPlan{Priority: 2}, &SubscriptionPlan{Priority: 5}))
	assert.Equal(t, 0, comparePlanTier(&SubscriptionPlan{Priority: 3, PriceAmount: 20}, &SubscriptionPlan{Priority: 3, PriceAmount: 20}))
	assert.Equal(t, 1, comparePlanTier(&SubscriptionPlan{Priority: 3, PriceAmount: 30}, &SubscriptionPlan{Priority: 3, PriceAmount: 20}))
	assert.Equal(t, -1, comparePlanTier(&SubscriptionPlan{Priority: 3, PriceAmount: 10}, &SubscriptionPlan{Priority: 3, PriceAmount: 20}))
	assert.Equal(t, 0, comparePlanTier(nil, nil))
}
