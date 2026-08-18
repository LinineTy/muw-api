package controller

import (
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// captureResponseWriter 包装 gin.ResponseWriter，把响应体复制一份到有限大小的缓冲区，
// 用于对话记录留存（流式 SSE 每个 chunk 也能捕获）。照 middleware/audit.go 的
// auditResponseWriter 嵌入模式，嵌入式保留 http.Flusher，流式兼容。
type captureResponseWriter struct {
	gin.ResponseWriter
	buf     []byte
	maxSize int
}

func (w *captureResponseWriter) Write(b []byte) (int, error) {
	if len(w.buf) < w.maxSize {
		remain := w.maxSize - len(w.buf)
		if remain >= len(b) {
			w.buf = append(w.buf, b...)
		} else {
			w.buf = append(w.buf, b[:remain]...)
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *captureResponseWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

// InstallConversationCapture 替换 c.Writer 为捕获 writer。maxSize<=0 时用默认 64KB。
func InstallConversationCapture(c *gin.Context, maxSize int) *captureResponseWriter {
	if maxSize <= 0 {
		maxSize = 65536
	}
	w := &captureResponseWriter{
		ResponseWriter: c.Writer,
		maxSize:        maxSize,
	}
	c.Writer = w
	return w
}

// ShouldRecordConversation 是否应留存本条请求：开启且为 chat 类模式，
// 排除内部子请求（视觉兜底等）与渠道测试。Playground（/pg 站内试用）也纳入留存：
// 风控中心需要审查游乐场里的违规内容；playground_conversations 只服务前端多设备
// 同步（客户端消息列表），与留存的请求/响应日志用途不同，不构成重复占量。
func ShouldRecordConversation(c *gin.Context, relayInfo *relaycommon.RelayInfo) bool {
	if c == nil || relayInfo == nil {
		return false
	}
	if !operation_setting.GetConversationRetentionSetting().Enabled {
		return false
	}
	if relayInfo.UserId <= 0 || relayInfo.IsChannelTest {
		return false
	}
	if common.GetContextKeyBool(c, constant.ContextKeyInternalSubRequest) {
		return false
	}
	switch relayInfo.RelayMode {
	case relayconstant.RelayModeChatCompletions,
		relayconstant.RelayModeResponses,
		relayconstant.RelayModeResponsesCompact,
		relayconstant.RelayModeGemini:
		return true
	}
	// Claude 原生 /v1/messages：Path2RelayMode 映射不到（RelayModeUnknown），按请求格式判定。
	// 该格式本身就是对话（messages），纳入留存；images/audio 等走各自模式不会被误纳。
	if relayInfo.GetFinalRequestRelayFormat() == types.RelayFormatClaude {
		return true
	}
	return false
}

// ExtractConversationRequestText 复用 GetTokenCountMeta().CombineText 提取请求文本；
// 图片 URL 保留、base64 省略（绝不存图片正文）。返回前不截断，由调用方按配置截断。
func ExtractConversationRequestText(request dto.Request) string {
	if request == nil {
		return ""
	}
	meta := request.GetTokenCountMeta()
	if meta == nil {
		return ""
	}
	var sb strings.Builder
	sb.WriteString(meta.CombineText)
	for _, f := range meta.Files {
		if f == nil || f.Source == nil {
			continue
		}
		if f.Source.IsURL() {
			sb.WriteString("\n[")
			sb.WriteString(string(f.FileType))
			sb.WriteString(" url] ")
			sb.WriteString(f.Source.GetRawData())
		} else {
			sb.WriteString("\n[")
			sb.WriteString(string(f.FileType))
			sb.WriteString(" base64 已省略]")
		}
	}
	return sb.String()
}

// persistConversationRecord 组装并异步落库（gopool），成功/失败双路径统一调用。
// 失败时错误 JSON 由 Relay 外层 defer 在之后写出，tee 可能为空，此时补 apiErr 错误文本。
func persistConversationRecord(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, apiErr *types.NewAPIError, tee *captureResponseWriter) {
	if relayInfo == nil || !ShouldRecordConversation(ctx, relayInfo) {
		return
	}
	setting := operation_setting.GetConversationRetentionSetting()

	reqText := truncateBytes(ExtractConversationRequestText(relayInfo.Request), setting.EffectiveRequestMaxBytes())
	respText := ""
	if tee != nil {
		respText = stripSSEPingLines(string(tee.buf))
	}

	statusCode := 0
	if tee != nil {
		statusCode = tee.Status()
	}
	if apiErr != nil {
		if respText == "" {
			if b, err := common.Marshal(gin.H{"error": apiErr.ToOpenAIError()}); err == nil {
				respText = string(b)
			}
		}
		if apiErr.StatusCode != 0 {
			statusCode = apiErr.StatusCode
		}
	}
	if statusCode == 0 {
		statusCode = 200
	}
	respText = truncateBytes(respText, setting.EffectiveResponseMaxBytes())

	rec := &model.ConversationRecord{
		UserId:     relayInfo.UserId,
		TokenId:    relayInfo.TokenId,
		ChannelId:  relayInfo.GetChannelID(),
		RequestId:  relayInfo.RequestId,
		ModelName:  relayInfo.OriginModelName,
		RelayMode:  relayInfo.RelayMode,
		IsStream:   relayInfo.IsStream,
		StatusCode: statusCode,
		Request:    reqText,
		Response:   respText,
		SizeBytes:  int64(len(reqText) + len(respText)),
	}
	gopool.Go(func() {
		if err := model.InsertConversationRecord(rec); err != nil {
			logger.LogError(ctx, "failed to insert conversation record: "+err.Error())
		}
	})
}

func truncateBytes(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	// 回退到最近的 UTF-8 rune 边界：多字节字符被切断会产生非法 UTF-8，
	// MySQL/PostgreSQL 的文本列会拒绝插入（SQLite 则存坏字节）。
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}

// stripSSEPingLines 剥掉流式响应里的 keep-alive 心跳注释行（": ping"/": PING"），
// 让留存文本更可读。只影响存储内容，不影响转发。
func stripSSEPingLines(s string) string {
	if !strings.Contains(s, ":") {
		return s
	}
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		t := strings.TrimSpace(l)
		if strings.HasPrefix(t, ":") && strings.Contains(strings.ToLower(t), "ping") {
			continue
		}
		out = append(out, l)
	}
	return strings.Join(out, "\n")
}
