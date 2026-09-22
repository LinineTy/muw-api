package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// 巡检通知只讲「已配模型消失」：新增是配置现状（一渠道一模型 vs 上游几百个），
// 进通知就是纯噪音 —— 首轮巡检后按既定口径收紧（2026-09-20）。
func TestBuildUpstreamModelUpdateNotificationContentOnlyRemovals(t *testing.T) {
	content := buildUpstreamModelUpdateTaskNotificationContent(
		28,
		1,
		2,
		nil,
		[]upstreamModelUpdateChannelSummary{{ChannelName: "DeepSeek-V4-Flash-0731(OpenRouter)", RemoveCount: 2}},
		[]string{"deepseek/deepseek-v4-flash-0731", "deepseek/deepseek-v4-flash"},
	)

	assert.Contains(t, content, "检测渠道 28 个")
	assert.Contains(t, content, "1 个渠道有模型下架（共 2 个）")
	assert.Contains(t, content, "下架渠道明细")
	assert.Contains(t, content, "DeepSeek-V4-Flash-0731(OpenRouter)（-2）")
	assert.Contains(t, content, "下架模型示例")
	assert.Contains(t, content, "deepseek/deepseek-v4-flash-0731")
	assert.NotContains(t, content, "新增")
	assert.NotContains(t, content, "变更渠道")
	assert.NotContains(t, content, "自动同步")
}

func TestBuildUpstreamModelUpdateNotificationContentFailuresOnly(t *testing.T) {
	content := buildUpstreamModelUpdateTaskNotificationContent(28, 0, 0, []int{7, 8}, nil, nil)

	assert.Contains(t, content, "0 个渠道有模型下架")
	assert.Contains(t, content, "失败 2 个")
	assert.Contains(t, content, "失败渠道 ID")
	assert.Contains(t, content, "7, 8")
	assert.NotContains(t, content, "下架模型示例")
}
