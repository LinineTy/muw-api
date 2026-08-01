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
package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// QuotaPoolSetting 额度池功能全局配置（单池：全站一个发放活动）
type QuotaPoolSetting struct {
	Enabled bool `json:"enabled"` // 额度池功能总开关

	// 全站周期：daily | weekly | monthly（全站总发放上限按此滚动重置）
	PoolPeriod string `json:"pool_period"`
	// 单用户周期：daily | weekly | monthly（单用户额度/次数上限按此滚动重置）
	UserPeriod string `json:"user_period"`
	// 发放模式：fixed 固定 / random 随机区间
	AmountType string `json:"amount_type"`
	// fixed 档发放额度（quota 单位）
	Amount int `json:"amount"`
	// random 档下限（quota 单位）
	MinAmount int `json:"min_amount"`
	// random 档上限（quota 单位）
	MaxAmount int `json:"max_amount"`

	// 全站周期总发放上限（quota 单位；0 = 不限）：全站周期内所有用户合计最多发这么多
	PoolPeriodCap int `json:"pool_period_cap"`
	// 单用户周期额度上限（quota 单位；0 = 不限）：用户周期内单用户累计最多拿这么多
	UserPeriodCap int `json:"user_period_cap"`
	// 单用户周期领取次数上限（0 = 不限）
	UserPeriodCountLimit int `json:"user_period_count_limit"`
	// 时间窗口：JSON 文本 [{dates:[], weekdays:[], periods:[{start,end}]}]
	TimeRule string `json:"time_rule"`
	// 余额门槛：mode = off | below | above；limit 为 quota 阈值
	BalanceMode  string `json:"balance_mode"`
	BalanceLimit int    `json:"balance_limit"`
}

// 默认配置：默认关闭，全站按天、单用户按周，随机档每周 1000~10000
var quotaPoolSetting = QuotaPoolSetting{
	Enabled:    false,
	PoolPeriod: "daily",
	UserPeriod: "weekly",
	AmountType: "random",
	MinAmount:  1000,
	MaxAmount:  10000,
}

func init() {
	config.GlobalConfig.Register("quota_pool_setting", &quotaPoolSetting)
}

func GetQuotaPoolSetting() *QuotaPoolSetting {
	return &quotaPoolSetting
}

func IsQuotaPoolEnabled() bool {
	return quotaPoolSetting.Enabled
}
