// @muw-owned
package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 站内消息（网页「消息」窗口）。
//
// 全部走 selfRoute（登录用户只能看自己的）：userId 从会话取，不接受请求参数里的 user_id，
// 归属校验则下沉到 SQL 的 WHERE user_id = ?（见 model.MarkUserNotificationsRead）。

// GetUserNotifications 当前登录用户的消息列表（含未读数）。
// 参数：page / page_size / unread_only（1 或 true 时只看未读）。
func GetUserNotifications(c *gin.Context) {
	userId := c.GetInt("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	unreadOnly := c.Query("unread_only") == "1" || c.Query("unread_only") == "true"

	result, err := model.GetUserNotifications(userId, page, pageSize, unreadOnly)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

type markNotificationsReadRequest struct {
	Ids []int `json:"ids"`
}

// MarkUserNotificationsRead 标记若干条为已读（消息窗口点开单条）。
func MarkUserNotificationsRead(c *gin.Context) {
	var req markNotificationsReadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	affected, err := model.MarkUserNotificationsRead(c.GetInt("id"), req.Ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"updated": affected})
}

// MarkAllUserNotificationsRead 全部标记已读（「全部已读」按钮）。
func MarkAllUserNotificationsRead(c *gin.Context) {
	affected, err := model.MarkAllUserNotificationsRead(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"updated": affected})
}
