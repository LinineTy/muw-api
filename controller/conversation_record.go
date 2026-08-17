package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GetConversationRecordDetail 管理端查看单条对话记录的完整正文（详情弹窗）。
func GetConversationRecordDetail(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	record, err := model.GetConversationRecord(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, record)
}

// GetConversationRecords 管理端查看对话记录（按 user/token/request_id/model/status 过滤，分页）。
func GetConversationRecords(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	tokenId, _ := strconv.Atoi(c.Query("token_id"))
	requestId := c.Query("request_id")
	modelName := c.Query("model_name")
	statusCode, _ := strconv.Atoi(c.Query("status_code"))
	start, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	records, total, err := model.ListConversationRecords(userId, tokenId, requestId, modelName, statusCode, start, end, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(records)
	common.ApiSuccess(c, pageInfo)
}
