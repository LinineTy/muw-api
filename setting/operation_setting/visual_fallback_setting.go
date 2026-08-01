package operation_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// VisualFallbackSetting controls the "image → text description" fallback that
// lets models without vision capability handle image requests. When a request
// contains images and the target model is not vision-capable, each image is
// sent to Model (a configured vision-capable model) which returns a text
// description; the description then replaces the image in the message before it
// is relayed to the original model.
type VisualFallbackSetting struct {
	Enabled bool `json:"enabled"`
	// Model is the vision-capable model used to describe images. It must have a
	// channel in the user's group and a configured price/ratio.
	Model string `json:"model"`
	// Prompt is the system prompt sent to the vision model.
	Prompt string `json:"prompt"`
	// SupportedModels lists models that already support vision (newline or comma
	// separated). Requests to these models skip the fallback.
	SupportedModels string `json:"supported_models"`
}

const defaultVisualFallbackPrompt = "你是一个图像描述助手。请仔细描述这张图片：" +
	"提取图中出现的所有文字（保留原文），并描述图标、按钮、形状、箭头、物体、人物等非文本元素及其位置与空间关系。" +
	"尽量保留阅读顺序与布局信息。只输出描述，不要解读、猜测或翻译。"

const defaultSupportedVisionModels = "gpt-4o\ngpt-4-turbo\ngpt-4-vision\ngpt-4.1\ngpt-4.5\n" +
	"claude-3\nclaude-3.5\nclaude-3.7\nclaude-4\n" +
	"gemini-1.5\ngemini-2\n" +
	"qwen-vl\nqwen2-vl\nqwen2.5-vl\nqwen3-vl\n" +
	"glm-4v\nglm-4.5v\nglm-5v\n" +
	"llava\npixtral\nphi-3-vision\nmoondream\nminicpm-v\ninternvl\ninternvl2\ninternvl3\n" +
	"grok-2-vision\ngrok-4\ndoubao-vision\nstep-1v"

// 默认配置
var visualFallbackSetting = VisualFallbackSetting{
	Enabled:         false,
	Model:           "",
	Prompt:          defaultVisualFallbackPrompt,
	SupportedModels: defaultSupportedVisionModels,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("visual_fallback_setting", &visualFallbackSetting)
}

func GetVisualFallbackSetting() *VisualFallbackSetting {
	return &visualFallbackSetting
}

// IsVisionCapable reports whether the model already supports vision, in which
// case the fallback is skipped. Matching is case-insensitive substring.
func (s *VisualFallbackSetting) IsVisionCapable(model string) bool {
	if s == nil || model == "" {
		return false
	}
	lower := strings.ToLower(model)
	for _, entry := range strings.FieldsFunc(s.SupportedModels, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	}) {
		if entry = strings.ToLower(strings.TrimSpace(entry)); entry != "" && strings.Contains(lower, entry) {
			return true
		}
	}
	return false
}
