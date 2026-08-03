package controller

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"

	"github.com/stretchr/testify/assert"
)

// TestShouldRecordUserTraffic 保护模型健康度记录的用户流量范围：单次请求/响应
// 模式（chat、生图、embedding、audio、rerank、responses 等）都应记录，realtime
// 长连接与渠道自测不记录。
func TestShouldRecordUserTraffic(t *testing.T) {
	tests := []struct {
		name       string
		info       *relaycommon.RelayInfo
		wantRecord bool
	}{
		{name: "nil", wantRecord: false},
		{name: "chat completions", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeChatCompletions}, wantRecord: true},
		{name: "image generations", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesGenerations}, wantRecord: true},
		{name: "embeddings", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeEmbeddings}, wantRecord: true},
		{name: "audio transcription", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeAudioTranscription}, wantRecord: true},
		{name: "rerank", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeRerank}, wantRecord: true},
		{name: "responses", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeResponses}, wantRecord: true},
		{name: "claude messages (unknown relay mode)", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeUnknown}, wantRecord: true},
		{name: "realtime websocket", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeRealtime}, wantRecord: false},
		{name: "channel self test", info: &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeChatCompletions, IsChannelTest: true}, wantRecord: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.wantRecord, shouldRecordUserTraffic(tt.info))
		})
	}
}
