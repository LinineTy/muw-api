package sensenova

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetRequestURLImageGeneration 保护 U1 Fast 文档契约：
// 图像生成走 https://token.sensenova.cn/v1/images/generations。
func TestGetRequestURLImageGeneration(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:    constant.ChannelTypeSenseNova,
			ChannelBaseUrl: "https://token.sensenova.cn",
		},
		RequestURLPath: "/v1/images/generations",
	}

	requestURL, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://token.sensenova.cn/v1/images/generations", requestURL)
}

func TestGetModelListContainsU1Fast(t *testing.T) {
	adaptor := &Adaptor{}
	assert.Contains(t, adaptor.GetModelList(), "sensenova-u1-fast")
	assert.Equal(t, "sensenova", adaptor.GetChannelName())
}

// TestConvertImageRequestWatermarkToggle 保护渠道「去水印」开关契约：
// 开启 sensenova_remove_watermark 后必须强制携带 watermark=false 上游，
// 关闭时透传客户端参数（不额外注入，保持兼容）。
func TestConvertImageRequestWatermarkToggle(t *testing.T) {
	adaptor := &Adaptor{}

	newInfo := func(removeWatermark bool) *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{
				ChannelOtherSettings: dto.ChannelOtherSettings{
					SensenovaRemoveWatermark: removeWatermark,
				},
			},
		}
	}

	t.Run("enabled forces watermark=false even when client omits it", func(t *testing.T) {
		converted, err := adaptor.ConvertImageRequest(nil, newInfo(true), dto.ImageRequest{Model: "sensenova-u1-fast", Prompt: "test"})
		require.NoError(t, err)
		out, err := common.Marshal(converted)
		require.NoError(t, err)
		require.Contains(t, string(out), `"watermark":false`)
	})

	t.Run("enabled overrides client watermark=true", func(t *testing.T) {
		wm := true
		converted, err := adaptor.ConvertImageRequest(nil, newInfo(true), dto.ImageRequest{Model: "sensenova-u1-fast", Prompt: "test", Watermark: &wm})
		require.NoError(t, err)
		out, err := common.Marshal(converted)
		require.NoError(t, err)
		require.Contains(t, string(out), `"watermark":false`)
	})

	t.Run("disabled passes through client watermark", func(t *testing.T) {
		wm := true
		converted, err := adaptor.ConvertImageRequest(nil, newInfo(false), dto.ImageRequest{Model: "sensenova-u1-fast", Prompt: "test", Watermark: &wm})
		require.NoError(t, err)
		out, err := common.Marshal(converted)
		require.NoError(t, err)
		require.Contains(t, string(out), `"watermark":true`)
	})

	t.Run("disabled and client omits watermark leaves field absent", func(t *testing.T) {
		converted, err := adaptor.ConvertImageRequest(nil, newInfo(false), dto.ImageRequest{Model: "sensenova-u1-fast", Prompt: "test"})
		require.NoError(t, err)
		out, err := common.Marshal(converted)
		require.NoError(t, err)
		require.NotContains(t, string(out), "watermark")
	})

	t.Run("nil info does not panic and passes through", func(t *testing.T) {
		wm := false
		converted, err := adaptor.ConvertImageRequest(nil, nil, dto.ImageRequest{Model: "sensenova-u1-fast", Prompt: "test", Watermark: &wm})
		require.NoError(t, err)
		out, err := common.Marshal(converted)
		require.NoError(t, err)
		require.Contains(t, string(out), `"watermark":false`)
	})

	t.Run("nil channel meta does not panic and passes through", func(t *testing.T) {
		converted, err := adaptor.ConvertImageRequest(nil, &relaycommon.RelayInfo{}, dto.ImageRequest{Model: "sensenova-u1-fast", Prompt: "test"})
		require.NoError(t, err)
		out, err := common.Marshal(converted)
		require.NoError(t, err)
		require.NotContains(t, string(out), "watermark")
	})
}
