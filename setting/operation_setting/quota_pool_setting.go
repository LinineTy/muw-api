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

// QuotaPoolSetting 额度池功能全局配置
type QuotaPoolSetting struct {
	Enabled bool `json:"enabled"` // 额度池功能总开关
}

// 默认配置：默认关闭
var quotaPoolSetting = QuotaPoolSetting{
	Enabled: false,
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
