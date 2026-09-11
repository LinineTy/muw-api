package constant

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetChannelBaseURLIsBoundsSafe(t *testing.T) {
	assert.Empty(t, GetChannelBaseURL(ChannelTypeTaskPlugin))
	assert.Empty(t, GetChannelBaseURL(9999))
}

func TestChannelTypeAllowsEmptyKey(t *testing.T) {
	assert.True(t, ChannelTypeAllowsEmptyKey(ChannelTypeOpenCodeZen), "OpenCode Zen 空密钥走免费套餐")
	assert.False(t, ChannelTypeAllowsEmptyKey(ChannelTypeOpenAI))
	assert.False(t, ChannelTypeAllowsEmptyKey(ChannelTypeSenseNova))
	assert.False(t, ChannelTypeAllowsEmptyKey(ChannelTypeUnknown))
}
