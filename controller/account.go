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
	"crypto/sha256"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// maskAccountKey 账户密钥脱敏预览：多 key（换行分隔）按 key 数量返回首 key 脱敏 + 计数；
// 单 key 保留前 4 + **** + 后 4；短 key 全遮。
func maskAccountKey(key string) string {
	if key == "" {
		return ""
	}
	if strings.Contains(key, "\n") {
		parts := strings.Split(strings.Trim(key, "\n"), "\n")
		return maskAccountKey(parts[0]) + fmt.Sprintf(" 等 %d 个", len(parts))
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "****" + key[len(key)-4:]
}

// fillAccountView 填充响应侧视图字段（脱敏预览/引用渠道数），并清掉不该下发的列。
func fillAccountView(account *model.Account) {
	account.KeyMasked = maskAccountKey(account.Key)
	account.Key = ""
	account.CodingPlanKeyMasked = maskCodingPlanKey(account.CodingPlanKey)
	account.CodingPlanKey = ""
	account.CodingPlanQuotaGroup = accountCodingPlanQuotaGroup(account)
	if account.ChannelInfo.IsMultiKey {
		account.ChannelInfo.MultiKeyDisabledReason = nil
		account.ChannelInfo.MultiKeyDisabledTime = nil
	}
}

// accountCodingPlanQuotaGroup 账户版套餐分组指纹：厂商 + 生效 key（套餐专用 key
// 优先）sha256 截断。同账户共享同值；非套餐账户返回空串。
func accountCodingPlanQuotaGroup(account *model.Account) string {
	effective := account.CodingPlanKey
	if effective == "" {
		effective = account.Key
	}
	if effective == "" || strings.Contains(effective, "\n") {
		return ""
	}
	provider := ""
	if account.CodingPlanProvider != nil {
		provider = *account.CodingPlanProvider
	}
	if provider == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(effective))
	return fmt.Sprintf("%s:%x", provider, sum[:8])
}

// GetAllAccounts 分页列表 + 每账户引用渠道数。
func GetAllAccounts(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("p"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	var keyword string
	if c.Query("keyword") != "" {
		keyword = c.Query("keyword")
	}
	var accounts []*model.Account
	var err error
	if keyword != "" {
		accounts, err = model.SearchAccounts(keyword)
	} else {
		accounts, err = model.GetAllAccounts((page-1)*pageSize, pageSize)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	total, err := model.CountAllAccounts()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 引用渠道数：一次 GROUP BY，避免逐账户 COUNT。
	refCounts, err := model.CountChannelAccountReferences()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 引用渠道摘要（名称/状态）：同样一次查完，列表页直接展示"被哪些渠道引用"。
	refsByAccount, err := model.ListChannelRefsByAccount()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(accounts))
	for _, account := range accounts {
		fillAccountView(account)
		refs := refsByAccount[account.Id]
		if refs == nil {
			refs = []model.ChannelRefView{}
		}
		items = append(items, gin.H{
			"account":       account,
			"channel_count": refCounts[account.Id],
			"referenced":    refCounts[account.Id] > 0,
			"channels":      refs,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":     items,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// GetAccount 详情（脱敏）。
func GetAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	account, err := model.GetAccountById(id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	fillAccountView(account)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    account,
	})
}

// GetAccountKey 账户密钥明文（安全验证中间件保护，审计高危）。
func GetAccountKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("账户ID格式错误: %v", err))
		return
	}
	account, err := model.GetAccountById(id, true)
	if err != nil || account == nil {
		common.ApiError(c, fmt.Errorf("获取账户信息失败: %v", err))
		return
	}
	recordManageAudit(c, "account.key_view", map[string]interface{}{
		"id":   account.Id,
		"name": account.Name,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "获取成功",
		"data": map[string]interface{}{
			"key": account.Key,
		},
	})
}

// validateAccount 账户校验（创建/更新共用）。
func validateAccount(account *model.Account, isAdd bool) error {
	if account == nil {
		return fmt.Errorf("账户不能为空")
	}
	if strings.TrimSpace(account.Name) == "" {
		return fmt.Errorf("账户名称不能为空")
	}
	if isAdd && account.Key == "" {
		// 账户允许空密钥吗？渠道侧 OpenCode Zen 允许；账户是凭证载体，允许空密钥
		//（由绑定渠道的类型决定是否可用），不做强校验。
	}
	// 编码套餐自动启停阈值校验（与渠道侧同规则）。
	if account.CodingPlanDisableThreshold != nil {
		d := *account.CodingPlanDisableThreshold
		if d < 1 || d > 100 {
			return fmt.Errorf("编码套餐禁用阈值必须在 1-100 之间")
		}
		if account.CodingPlanEnableThreshold != nil && *account.CodingPlanEnableThreshold >= d {
			return fmt.Errorf("编码套餐恢复阈值必须小于禁用阈值")
		}
	}
	if account.CodingPlanEnableThreshold != nil {
		if e := *account.CodingPlanEnableThreshold; e < 0 || e > 100 {
			return fmt.Errorf("编码套餐恢复阈值必须在 0-100 之间")
		}
	}
	return nil
}

// AddAccount 创建账户。key 经请求体独立字段接收（json:"-" 不绑入 model）。
func AddAccount(c *gin.Context) {
	var req struct {
		Name                       string  `json:"name"`
		Type                       int     `json:"type"`
		Key                        string  `json:"key"`
		BaseURL                    *string `json:"base_url"`
		OpenAIOrganization         *string `json:"openai_organization"`
		Setting                    *string `json:"setting"`
		Other                      string  `json:"other"`
		CodingPlanProvider         *string `json:"coding_plan_provider"`
		CodingPlanKey              *string `json:"coding_plan_key"`
		CodingPlanAutoControl      *bool   `json:"coding_plan_auto_control"`
		CodingPlanDisableThreshold *int    `json:"coding_plan_disable_threshold"`
		CodingPlanEnableThreshold  *int    `json:"coding_plan_enable_threshold"`
		Remark                     *string `json:"remark"`
		// 多 key 支持：multi_to_single 语义（换行分隔 key 合一存储）
		IsMultiKey   bool   `json:"is_multi_key"`
		MultiKeyMode string `json:"multi_key_mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	account := &model.Account{
		Name:                       req.Name,
		Type:                       req.Type,
		Status:                     common.ChannelStatusEnabled,
		Key:                        req.Key,
		BaseURL:                    req.BaseURL,
		OpenAIOrganization:         req.OpenAIOrganization,
		Setting:                    req.Setting,
		Other:                      req.Other,
		CodingPlanProvider:         req.CodingPlanProvider,
		CodingPlanKey:              derefString(req.CodingPlanKey),
		CodingPlanAutoControl:      req.CodingPlanAutoControl,
		CodingPlanDisableThreshold: req.CodingPlanDisableThreshold,
		CodingPlanEnableThreshold:  req.CodingPlanEnableThreshold,
		Remark:                     req.Remark,
		CreatedTime:                common.GetTimestamp(),
	}
	if req.CodingPlanKey != nil {
		account.CodingPlanKey = *req.CodingPlanKey
	}
	if req.IsMultiKey {
		account.ChannelInfo.IsMultiKey = true
		account.ChannelInfo.MultiKeyMode = constant.MultiKeyMode(req.MultiKeyMode)
		cleanKeys := make([]string, 0)
		for _, key := range strings.Split(req.Key, "\n") {
			if strings.TrimSpace(key) != "" {
				cleanKeys = append(cleanKeys, strings.TrimSpace(key))
			}
		}
		account.Key = strings.Join(cleanKeys, "\n")
		account.ChannelInfo.MultiKeySize = len(cleanKeys)
	}
	if err := validateAccount(account, true); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := account.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "account.create", map[string]interface{}{
		"name": account.Name,
		"type": account.Type,
		"id":   account.Id,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"id": account.Id}})
}

// derefString 空指针安全取值。
func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// UpdateAccount 更新账户。凭证字段（key）显式携带才更新（json:"-" 不自动绑定）；
// 换 key 后多 key 状态失效重算 MultiKeySize。
func UpdateAccount(c *gin.Context) {
	var req struct {
		Id                         int     `json:"id"`
		Name                       *string `json:"name"`
		Type                       *int    `json:"type"`
		Key                        *string `json:"key"`
		BaseURL                    *string `json:"base_url"`
		OpenAIOrganization         *string `json:"openai_organization"`
		Setting                    *string `json:"setting"`
		Other                      *string `json:"other"`
		CodingPlanProvider         *string `json:"coding_plan_provider"`
		CodingPlanKey              *string `json:"coding_plan_key"`
		CodingPlanAutoControl      *bool   `json:"coding_plan_auto_control"`
		CodingPlanDisableThreshold *int    `json:"coding_plan_disable_threshold"`
		CodingPlanEnableThreshold  *int    `json:"coding_plan_enable_threshold"`
		Remark                     *string `json:"remark"`
		Status                     *int    `json:"status"`
		MultiKeyMode               *string `json:"multi_key_mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	account, err := model.GetAccountById(req.Id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	changedFields := make([]string, 0)
	if req.Name != nil {
		account.Name = *req.Name
		changedFields = append(changedFields, "name")
	}
	if req.Type != nil {
		// 账户换类型：同步所有引用渠道的 channels.type（反规范化副本，
		// base_url 默认值/适配器/type_counts 依赖它），并重建 abilities。
		if err := model.SyncChannelsTypeByAccount(account.Id, *req.Type); err != nil {
			common.ApiError(c, err)
			return
		}
		account.Type = *req.Type
		changedFields = append(changedFields, "type")
	}
	if req.Key != nil {
		account.Key = *req.Key
		changedFields = append(changedFields, "key")
		// key 变了：多 key 状态清空重算（旧索引/启停对新 key 列表无意义）。
		account.ChannelInfo.MultiKeyStatusList = nil
		account.ChannelInfo.MultiKeyDisabledReason = nil
		account.ChannelInfo.MultiKeyDisabledTime = nil
		account.ChannelInfo.MultiKeyPollingIndex = 0
		account.ChannelInfo.MultiKeySize = len(account.GetKeys())
	}
	if req.BaseURL != nil {
		account.BaseURL = req.BaseURL
		changedFields = append(changedFields, "base_url")
	}
	if req.OpenAIOrganization != nil {
		account.OpenAIOrganization = req.OpenAIOrganization
		changedFields = append(changedFields, "openai_organization")
	}
	if req.Setting != nil {
		account.Setting = req.Setting
		changedFields = append(changedFields, "setting")
	}
	if req.Other != nil {
		account.Other = *req.Other
		changedFields = append(changedFields, "other")
	}
	if req.CodingPlanProvider != nil {
		account.CodingPlanProvider = req.CodingPlanProvider
		changedFields = append(changedFields, "coding_plan_provider")
	}
	if req.CodingPlanKey != nil {
		account.CodingPlanKey = *req.CodingPlanKey
		changedFields = append(changedFields, "coding_plan_key")
	}
	if req.CodingPlanAutoControl != nil {
		account.CodingPlanAutoControl = req.CodingPlanAutoControl
		changedFields = append(changedFields, "coding_plan_auto_control")
	}
	if req.CodingPlanDisableThreshold != nil {
		account.CodingPlanDisableThreshold = req.CodingPlanDisableThreshold
		changedFields = append(changedFields, "coding_plan_disable_threshold")
	}
	if req.CodingPlanEnableThreshold != nil {
		account.CodingPlanEnableThreshold = req.CodingPlanEnableThreshold
		changedFields = append(changedFields, "coding_plan_enable_threshold")
	}
	if req.Remark != nil {
		account.Remark = req.Remark
		changedFields = append(changedFields, "remark")
	}
	if req.Status != nil {
		account.Status = *req.Status
		changedFields = append(changedFields, "status")
	}
	if req.MultiKeyMode != nil && *req.MultiKeyMode != "" {
		account.ChannelInfo.MultiKeyMode = constant.MultiKeyMode(*req.MultiKeyMode)
		changedFields = append(changedFields, "multi_key_mode")
	}
	if err := validateAccount(account, false); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := account.Save(); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	recordManageAudit(c, "account.update", map[string]interface{}{
		"id":             account.Id,
		"name":           account.Name,
		"changed_fields": changedFields,
	})
	fillAccountView(account)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": account})
}

// DeleteAccount 删除账户（仍有渠道引用时 model 层拒绝）。
func DeleteAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	account, err := model.GetAccountById(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := account.Delete(); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	recordManageAudit(c, "account.delete", map[string]interface{}{
		"id":   account.Id,
		"name": account.Name,
	})
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// ListAccountChannelRefs 列出引用某账户的渠道（换绑/删除前的确认视图）。
func ListAccountChannelRefs(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channels, err := model.GetChannelsByAccount(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	type refItem struct {
		Id     int    `json:"id"`
		Name   string `json:"name"`
		Status int    `json:"status"`
		Models string `json:"models"`
	}
	refs := make([]refItem, 0, len(channels))
	for _, ch := range channels {
		refs = append(refs, refItem{Id: ch.Id, Name: ch.Name, Status: ch.Status, Models: ch.Models})
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    refs,
	})
}

// GetAccountCodingPlanQuota 查询账户的编码套餐余量。
//
// 余量按账户维度（凭证真相源）：多渠道共享同一账户时只查一次、共享同一张卡；同一渠道
// 绑多账户时各账户各查各的。账户需显式开启监控（coding_plan_provider）；查询 key 用
// 套餐专用 key，留空用账户自身 key（多 key 账户取第一把）。
func GetAccountCodingPlanQuota(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "Invalid account id")
		return
	}
	account, err := model.GetAccountById(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	provider, err := service.ResolveAccountCodingPlanProvider(account)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	key, err := CodingPlanQueryKeyOfAccount(account)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	quota, err := service.QueryCodingPlanQuota(c.Request.Context(), provider, key)
	if err != nil {
		common.ApiErrorMsg(c, fmt.Sprintf("Failed to query coding plan quota: %s", err.Error()))
		return
	}
	common.ApiSuccess(c, quota)
}
