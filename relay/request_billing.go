package relay

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// PrepareRequestBilling estimates and reserves one request's charge. Transports
// provide the current request body through BodyStorage or BillingRequestInput;
// channel retries retain the resulting billing session and pricing snapshot.
func PrepareRequestBilling(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	needSensitiveCheck := setting.ShouldCheckPromptSensitive()
	// 入口（controller.Relay）已算过 meta 时直接复用：同一请求不重复拼 CombineText。
	// 未缓存（如 Responses WebSocket 内层请求）才自行构建。
	meta := info.GetPricedTokenMeta()
	if meta == nil {
		meta = &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
		if info.Request != nil && (needSensitiveCheck || constant.CountToken) {
			meta = info.Request.GetTokenCountMeta()
		} else {
			// Avoid building CombineText when only the pricing quantities are needed.
			switch request := info.Request.(type) {
			case *dto.GeneralOpenAIRequest:
				meta.MaxTokens = int(max(lo.FromPtr(request.MaxTokens), lo.FromPtr(request.MaxCompletionTokens)))
			case *dto.OpenAIResponsesRequest:
				meta.MaxTokens = int(lo.FromPtr(request.MaxOutputTokens))
			case *dto.ClaudeRequest:
				meta.MaxTokens = int(lo.FromPtr(request.MaxTokens))
			case *dto.ImageRequest:
				meta = request.GetTokenCountMeta()
			}
		}
	}

	// 敏感词：按我方口径——内部子请求跳过；命中先记信誉分，只有 StopOnSensitiveEnabled
	// 打开才拦截（关闭时只记录不拦，避免词库误伤挡掉正常请求）。
	if needSensitiveCheck && meta != nil && !common.GetContextKeyBool(c, constant.ContextKeyInternalSubRequest) {
		if contains, words := service.CheckSensitiveText(meta.CombineText); contains {
			message := fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", "))
			logger.LogWarn(c, message)
			// 信誉分：本地关键词命中扣分（审计留痕），无论是否拦截都会扣。
			service.ApplyKeywordCreditDeduction(c, info, words)
			if setting.StopOnSensitiveEnabled {
				service.RequestPolicy(c).AddEvent(service.PolicyEvent{ErrorCode: string(types.ErrorCodeSensitiveWordsDetected), ErrorSource: "local", Decision: service.PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
				return types.NewError(errors.New(message), types.ErrorCodeSensitiveWordsDetected)
			}
		}
	}

	tokens := info.GetEstimatePromptTokens()
	if tokens <= 0 {
		var err error
		tokens, err = service.EstimateRequestToken(c, meta, info)
		if err != nil {
			return types.NewError(err, types.ErrorCodeCountTokenFailed)
		}
		info.SetEstimatePromptTokens(tokens)
	}

	priceData, err := helper.ModelPriceHelper(c, info, tokens, meta)
	if err != nil {
		return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
	}
	if priceData.FreeModel {
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", info.OriginModelName))
		return nil
	}
	return service.PreConsumeBilling(c, priceData.QuotaToPreConsume, info)
}

// RefundFailedRequestBilling applies the common final-failure policy after all
// eligible attempts have ended. A settled BillingSession never refunds again.
func RefundFailedRequestBilling(c *gin.Context, info *relaycommon.RelayInfo, apiErr *types.NewAPIError) *types.NewAPIError {
	if apiErr == nil {
		return nil
	}
	apiErr = service.NormalizeViolationFeeError(apiErr)
	if info.Billing != nil {
		info.Billing.Refund(c)
	}
	service.ChargeViolationFeeIfNeeded(c, info, apiErr)
	return apiErr
}
