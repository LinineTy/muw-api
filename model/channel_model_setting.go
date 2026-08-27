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
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/samber/lo"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ChannelModelSetting 渠道内单个模型的覆盖设置：
//   - Enabled=false 表示该渠道内此模型被禁用（abilities 重建时合并为 enabled=false，选路排除）。
//   - ContextWindow 非 nil 表示该渠道内此模型的上下文窗口覆盖（nil=继承模型默认，见
//     GetModelContextWindow）。渠道级覆盖 > 模型默认 > 不限制。
//
// 约定：表中无行 = 该模型启用 + 上下文用模型默认；只写非默认值行，避免每渠道 N 行膨胀。
// 不使用 gorm:"default:true"（AGENTS.md 禁 boolean 默认标签），插入时由调用方显式构造 Enabled。
type ChannelModelSetting struct {
	ChannelId     int    `json:"channel_id" gorm:"primaryKey"`
	Model         string `json:"model" gorm:"type:varchar(255);primaryKey"`
	Enabled       bool   `json:"enabled"`
	ContextWindow *int   `json:"context_window"`
	UpdatedAt     int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (ChannelModelSetting) TableName() string { return "channel_model_settings" }

// UpsertChannelModelSettings 批量写入渠道模型设置，已存在的组合更新 enabled/context_window。
// 行的 ChannelId 一律强制为传入的 channelId：调用方（Channel.Update / BatchInsertChannels）
// 可能从请求体绑定拿到 ChannelId=0 的行，必须在此归一，否则会写入 (channel_id=0, model)。
func UpsertChannelModelSettings(channelId int, settings []ChannelModelSetting) error {
	return upsertChannelModelSettingsWithDB(DB, channelId, settings)
}

// upsertChannelModelSettingsWithDB 同 UpsertChannelModelSettings，但使用指定 db
// （供 BatchInsertChannels 在事务内写入）。
func upsertChannelModelSettingsWithDB(db *gorm.DB, channelId int, settings []ChannelModelSetting) error {
	if len(settings) == 0 {
		return nil
	}
	rows := make([]ChannelModelSetting, 0, len(settings))
	for _, s := range settings {
		s.ChannelId = channelId
		rows = append(rows, s)
	}
	for _, chunk := range lo.Chunk(rows, 50) {
		err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "channel_id"}, {Name: "model"}},
			DoUpdates: clause.AssignmentColumns([]string{"enabled", "context_window", "updated_at"}),
		}).Create(&chunk).Error
		if err != nil {
			return err
		}
	}
	return nil
}

// CleanupStaleChannelModelSettings 删除渠道 models 列表中已不存在的设置行。
// 渠道改 models（移除某个模型）后调用，避免设置残留。
func CleanupStaleChannelModelSettings(channelId int, models []string) error {
	if len(models) == 0 {
		return DB.Where("channel_id = ?", channelId).Delete(&ChannelModelSetting{}).Error
	}
	return DB.Where("channel_id = ? AND model NOT IN (?)", channelId, models).Delete(&ChannelModelSetting{}).Error
}

// ReplaceChannelModelSettings 全量对齐某渠道的模型设置：事务内 upsert 传入行，
// 并删除该渠道下不在传入集合中的行。前端只提交「已配置」的行（禁用或上下文覆盖），
// 其余模型视为默认；传入空集合 = 该渠道全部恢复默认（清空表内行）。
// 替代 UpsertChannelModelSettings + CleanupStaleChannelModelSettings 的组合：
// 全量语义保证「删行恢复默认」时表内旧 enabled=false 行一并清除，禁用态不会残留。
func ReplaceChannelModelSettings(channelId int, settings []ChannelModelSetting) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if len(settings) > 0 {
			if err := upsertChannelModelSettingsWithDB(tx, channelId, settings); err != nil {
				return err
			}
		}
		models := make([]string, 0, len(settings))
		for _, s := range settings {
			models = append(models, s.Model)
		}
		query := tx.Where("channel_id = ?", channelId)
		if len(models) > 0 {
			query = query.Where("model NOT IN (?)", models)
		}
		return query.Delete(&ChannelModelSetting{}).Error
	})
}

// GetChannelModelSettings 读取某渠道全部模型设置。
func GetChannelModelSettings(channelId int) ([]ChannelModelSetting, error) {
	var settings []ChannelModelSetting
	err := DB.Where("channel_id = ?", channelId).Find(&settings).Error
	return settings, err
}

// DisabledModelsOfChannel 返回某渠道被禁用的模型集合。
func DisabledModelsOfChannel(channelId int) (map[string]bool, error) {
	var models []string
	err := DB.Model(&ChannelModelSetting{}).
		Where("channel_id = ? AND enabled = ?", channelId, false).
		Pluck("model", &models).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]bool, len(models))
	for _, m := range models {
		result[m] = true
	}
	return result, nil
}

// ChannelModelContextWindow 返回渠道内某模型的上下文覆盖；无覆盖返回 (0, false)。
func ChannelModelContextWindow(channelId int, model string) (int, bool) {
	var setting ChannelModelSetting
	err := DB.Select("context_window").
		Where("channel_id = ? AND model = ? AND context_window IS NOT NULL", channelId, model).
		First(&setting).Error
	if err != nil || setting.ContextWindow == nil {
		return 0, false
	}
	return *setting.ContextWindow, true
}

// 内存缓存「存在至少一个渠道级 context_window 覆盖的模型」集合，供 relay 热路径
// （ModelHasChannelContextOverride）判定是否需要逐渠道校验上下文窗口。随渠道缓存
// （LoadAllChannelModelSettings / InitChannelCache）一起刷新，避免每请求一次 DB COUNT。
var (
	channelContextOverrideLock       sync.RWMutex
	modelsWithChannelContextOverride = make(map[string]struct{})
)

// setModelsWithChannelContextOverride 替换「有渠道覆盖的模型」集合。
// 由 LoadAllChannelModelSettings 在构建缓存索引时调用。
func setModelsWithChannelContextOverride(models map[string]struct{}) {
	channelContextOverrideLock.Lock()
	modelsWithChannelContextOverride = models
	channelContextOverrideLock.Unlock()
}

// ModelHasChannelContextOverride 判断是否存在针对该模型的渠道级 context_window 覆盖。
// 供 relay 在选渠道前决定是否需要构建完整 TokenCountMeta（渠道级覆盖校验要算 token，
// fast 版 CombineText 为空算不出）。读内存缓存，不落 DB。
func ModelHasChannelContextOverride(modelName string) bool {
	channelContextOverrideLock.RLock()
	defer channelContextOverrideLock.RUnlock()
	_, ok := modelsWithChannelContextOverride[modelName]
	return ok
}

// LoadAllChannelModelSettings 一次性加载全部渠道模型设置，返回按渠道分组的禁用集合
// 与上下文覆盖集合。供 InitChannelCache 在构建缓存索引时过滤禁用模型。
func LoadAllChannelModelSettings() (disabled map[int]map[string]bool, contextWindows map[int]map[string]int) {
	var settings []ChannelModelSetting
	if err := DB.Find(&settings).Error; err != nil {
		common.SysLog("failed to load channel model settings: " + err.Error())
		return make(map[int]map[string]bool), make(map[int]map[string]int)
	}
	disabled = make(map[int]map[string]bool)
	contextWindows = make(map[int]map[string]int)
	overrideModels := make(map[string]struct{})
	for _, s := range settings {
		if !s.Enabled {
			if disabled[s.ChannelId] == nil {
				disabled[s.ChannelId] = make(map[string]bool)
			}
			disabled[s.ChannelId][s.Model] = true
		}
		if s.ContextWindow != nil {
			if contextWindows[s.ChannelId] == nil {
				contextWindows[s.ChannelId] = make(map[string]int)
			}
			contextWindows[s.ChannelId][s.Model] = *s.ContextWindow
			overrideModels[s.Model] = struct{}{}
		}
	}
	// 同步「有渠道覆盖的模型」集合，relay 热路径直接读内存
	setModelsWithChannelContextOverride(overrideModels)
	return disabled, contextWindows
}
