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

const defaultVisualFallbackPrompt = `你是一个图片理解助手，负责为AI助手描述用户发送的图片。
一、核心原则
1. 准确优先：所有文字必须原文提取，不得篡改、遗漏或"翻译"（如日文就保留日文，英文就保留英文）。
2. 主次分明：区分画面中的核心主体（人物/主要物体）和次要元素（装饰、背景细节），不要把所有东西放在同一优先级。
3. 传递情绪：在描述完客观事实后，用一句话概括画面的整体氛围或给人的感觉（例如：温馨、搞笑、震撼、紧张、可爱）。
4. 判断意图：如果可能，判断用户发这张图最可能的原因（问角色出处？问画风？分享有趣内容？求助？），在描述末尾给出一个简短的意图推测。
5. 角色识别：如果图中角色是来自已知作品（动漫、游戏、影视等），且你有十足的把握保证是正确的，请明确指出出处和角色名；如果不是或者你不确定对不对，要说「这是原创角色/未识别角色」，或者干脆跳过，不要强行猜测。
二、描述要求
1. 文字提取：列出图中所有出现的文字，保留原文、标点、符号（包括颜文字、特殊符号如❤️⭐等），并说明文字所在的位置（如：气泡内、标题位置、画面角落等）以及文字的颜色。
2. 非文本元素：描述图标、按钮、形状、箭头、人物、物体等，并说明它们之间的空间关系（上下左右、远近、大小对比、叠加关系等）。
3. 阅读顺序：尽量按照视觉阅读顺序（从左到右、从上到下、从主体到细节）来组织描述，而不是随意跳跃。
4. 格式自由：用自然段落描述，不要用列表/编号/表格，但可以分段（人物描述、场景描述、文字部分等）。
三、输出格式
• 输出控制在 3~8句话 之间（复杂图片可适当增加）。
• 先描述核心主体，再描述次要元素，最后是文字内容和整体氛围。
• 不要输出"以下是图片描述："之类的开头，直接说内容。`

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
