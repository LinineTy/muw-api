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
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetModelHealth aggregates channel test history per (channel, model) over a
// configurable window. Filters: days (default 7), channel_id, q (search on
// channel/model name), unhealthy (only rows with a failure in the window).
func GetModelHealth(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days <= 0 || days > 90 {
		days = 7
	}
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour).Unix()
	channelID, _ := strconv.Atoi(c.Query("channel_id"))
	q := strings.TrimSpace(c.Query("q"))
	unhealthyOnly := c.Query("unhealthy") == "true" || c.Query("unhealthy") == "1"

	query := model.DB.Model(&model.ChannelTestRecord{}).Where("created_at >= ?", cutoff)
	if channelID > 0 {
		query = query.Where("channel_id = ?", channelID)
	}
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("(channel_name LIKE ? OR model_name LIKE ?)", like, like)
	}

	var records []model.ChannelTestRecord
	if err := query.Find(&records).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	rows := model.AggregateChannelTestRecords(records)
	if c.GetInt("role") < common.RoleAdminUser {
		// Non-admin viewers get model-level aggregation only: channel identity,
		// per-channel latency and error reasons must not leak.
		rows = model.CollapseToModelLevel(rows)
	}
	if unhealthyOnly {
		filtered := rows[:0]
		for _, row := range rows {
			if row.SuccessRate < 100 {
				filtered = append(filtered, row)
			}
		}
		rows = filtered
	}
	common.ApiSuccess(c, rows)
}

// GetChannelTestRecords returns the raw paginated test history for a channel
// (and optional model), newest first, for the detail drawer.
func GetChannelTestRecords(c *gin.Context) {
	channelID, _ := strconv.Atoi(c.Query("channel_id"))
	modelName := strings.TrimSpace(c.Query("model"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	query := model.DB.Model(&model.ChannelTestRecord{})
	if channelID > 0 {
		query = query.Where("channel_id = ?", channelID)
	}
	if modelName != "" {
		query = query.Where("model_name = ?", modelName)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	var records []model.ChannelTestRecord
	if err := query.Order("created_at desc, id desc").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&records).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"records": records,
		"total":   total,
	})
}
