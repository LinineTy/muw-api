package sensenova

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

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
