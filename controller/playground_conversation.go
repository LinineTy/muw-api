package controller

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// maxConversationMessagesBytes 单会话消息体上限（JSON 文本），防止异常大包打满 DB。
const maxConversationMessagesBytes = 2 << 20

// ListPlaygroundConversations 返回当前用户全部同步会话（最新更新在前），
// messages 以原始 JSON 透传。
func ListPlaygroundConversations(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	conversations, err := model.ListPlaygroundConversationsByUser(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	type conversationItem struct {
		Id          int             `json:"id"`
		ClientId    string          `json:"client_id"`
		Title       string          `json:"title"`
		Messages    json.RawMessage `json:"messages"`
		CreatedTime int64           `json:"created_time"`
		UpdatedTime int64           `json:"updated_time"`
	}
	items := make([]conversationItem, 0, len(conversations))
	for _, conv := range conversations {
		items = append(items, conversationItem{
			Id:          conv.Id,
			ClientId:    conv.ClientId,
			Title:       conv.Title,
			Messages:    json.RawMessage(conv.Messages),
			CreatedTime: conv.CreatedTime,
			UpdatedTime: conv.UpdatedTime,
		})
	}
	common.ApiSuccess(c, items)
}

// SavePlaygroundConversation upsert 一个会话（按 client_id 幂等）。
// body {client_id, title, messages}，messages 为完整 JSON 数组文本。
func SavePlaygroundConversation(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}
	clientId := c.Param("clientId")

	var request struct {
		Title    string          `json:"title"`
		Messages json.RawMessage `json:"messages"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	clientId = strings.TrimSpace(clientId)
	if clientId == "" || len(clientId) > 64 {
		common.ApiErrorMsg(c, "无效的会话 ID")
		return
	}
	title := strings.TrimSpace(request.Title)
	if len([]rune(title)) > 255 {
		title = string([]rune(title)[:255])
	}
	// messages 为 null 字面量时 json.RawMessage 会保留为 4 字节 "null"，同样视为空。
	if len(request.Messages) == 0 || string(request.Messages) == "null" {
		common.ApiErrorMsg(c, "消息内容为空")
		return
	}
	if len(request.Messages) > maxConversationMessagesBytes {
		common.ApiErrorMsg(c, "消息内容过大")
		return
	}

	conv := &model.PlaygroundConversation{
		UserId:   userId,
		ClientId: clientId,
		Title:    title,
		Messages: string(request.Messages),
	}
	if err := model.UpsertPlaygroundConversation(conv); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"updated_time": conv.UpdatedTime})
}

// DeletePlaygroundConversation 软删某用户的指定会话。仅本人可删。
func DeletePlaygroundConversation(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}
	clientId := c.Param("clientId")
	if strings.TrimSpace(clientId) == "" {
		common.ApiErrorMsg(c, "无效的会话 ID")
		return
	}

	if _, err := model.GetPlaygroundConversationByClientId(userId, clientId); err != nil {
		c.JSON(403, gin.H{"success": false, "message": "无权删除该会话"})
		return
	}
	if err := model.DeletePlaygroundConversationByClientId(userId, clientId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
