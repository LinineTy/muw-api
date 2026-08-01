package operation_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVisualFallbackSettingIsVisionCapable(t *testing.T) {
	s := VisualFallbackSetting{SupportedModels: defaultSupportedVisionModels}

	tests := []struct {
		name  string
		model string
		want  bool
	}{
		{name: "gpt-4o", model: "gpt-4o", want: true},
		{name: "gpt-4o-mini", model: "gpt-4o-mini", want: true},
		{name: "gpt-4-turbo-2024-04-09", model: "gpt-4-turbo-2024-04-09", want: true},
		{name: "gpt-4-vision-preview", model: "gpt-4-vision-preview", want: true},
		{name: "gpt-4.1-mini", model: "gpt-4.1-mini", want: true},
		{name: "claude-3-5-sonnet", model: "claude-3-5-sonnet", want: true},
		{name: "claude-4-sonnet", model: "claude-4-sonnet", want: true},
		{name: "gemini-1.5-flash", model: "gemini-1.5-flash", want: true},
		{name: "gemini-2.0-flash", model: "gemini-2.0-flash", want: true},
		{name: "qwen2.5-vl-72b", model: "qwen2.5-vl-72b", want: true},
		{name: "glm-4.5v", model: "glm-4.5v", want: true},
		{name: "llava-13b", model: "llava-13b", want: true},
		{name: "pixtral-large", model: "pixtral-large", want: true},
		{name: "grok-2-vision-1212", model: "grok-2-vision-1212", want: true},
		{name: "case-insensitive gpt-4o", model: "GPT-4O", want: true},
		{name: "text-only deepseek-chat", model: "deepseek-chat", want: false},
		{name: "text-only gpt-3.5-turbo", model: "gpt-3.5-turbo", want: false},
		{name: "text-only glm-4-flash", model: "glm-4-flash", want: false},
		{name: "empty model", model: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, s.IsVisionCapable(tt.model))
		})
	}
}

func TestVisualFallbackSettingIsVisionCapableCustomList(t *testing.T) {
	// An admin-defined list overrides the default.
	s := VisualFallbackSetting{SupportedModels: "my-vision\ndemo-4v"}
	assert.True(t, s.IsVisionCapable("my-vision-x"))
	assert.True(t, s.IsVisionCapable("demo-4v"))
	assert.False(t, s.IsVisionCapable("gpt-4o"))
	assert.False(t, s.IsVisionCapable(""))
}

func TestVisualFallbackSettingConfigRoundTrip(t *testing.T) {
	// Preserve the global setting and restore it after the test.
	orig := visualFallbackSetting
	t.Cleanup(func() { visualFallbackSetting = orig })

	cfg := config.GlobalConfig.Get("visual_fallback_setting")
	require.NotNil(t, cfg, "visual_fallback_setting module should be registered")

	// This mirrors what model.updateOptionMap routes to the config system when
	// the frontend saves the Visual Fallback section.
	require.NoError(t, config.UpdateConfigFromMap(cfg, map[string]string{
		"enabled":          "true",
		"model":            "gpt-4o",
		"prompt":           "describe it",
		"supported_models": "custom-vision",
	}))

	s := GetVisualFallbackSetting()
	assert.True(t, s.Enabled)
	assert.Equal(t, "gpt-4o", s.Model)
	assert.Equal(t, "describe it", s.Prompt)
	assert.Equal(t, "custom-vision", s.SupportedModels)
	assert.True(t, s.IsVisionCapable("custom-vision"))
	assert.False(t, s.IsVisionCapable("gpt-4o"))
}
