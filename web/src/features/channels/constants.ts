/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
// ============================================================================
// Channel Types (from constant/channel.go)
// All label/name values are i18n keys; use t(value) when displaying.
// ============================================================================

export const CHANNEL_TYPE_NEW_API = 60

export const CHANNEL_TYPE_OPENCODE_ZEN = 62

export const CHANNEL_TYPES = {
  0: 'Unknown',
  1: 'OpenAI',
  2: 'MjProxy',
  3: 'Azure',
  4: 'Ollama',
  5: 'MjProxyPlus',
  // 6: 'OpenAIMax',
  7: 'OhMyGPT',
  8: 'Custom',
  // 9: 'AILS',
  // 10: 'AI Proxy',
  // 11: 'PaLM',
  // 12: 'API2GPT',
  // 13: 'AIGC2D',
  14: 'Anthropic',
  15: 'Baidu',
  17: 'Ali',
  18: 'Xunfei',
  19: '360',
  20: 'OpenRouter',
  // 21: 'AI Proxy Library',
  22: 'FastGPT',
  23: 'Tencent',
  24: 'Gemini',
  25: 'Moonshot',
  26: 'Zhipu V4',
  27: 'Perplexity',
  31: 'LingYiWanWu',
  33: 'AWS',
  34: 'Cohere',
  35: 'MiniMax',
  36: 'SunoAPI',
  37: 'Dify',
  38: 'Jina',
  39: 'Cloudflare',
  40: 'SiliconFlow',
  41: 'Vertex AI',
  42: 'Mistral',
  43: 'DeepSeek',
  44: 'MokaAI',
  45: 'VolcEngine',
  46: 'Baidu V2',
  47: 'Xinference',
  48: 'xAI',
  49: 'Coze',
  50: 'Kling',
  51: 'Jimeng',
  52: 'Vidu',
  53: 'Submodel',
  54: 'DoubaoVideo',
  55: 'Sora',
  56: 'Replicate',
  57: 'ChatGPT Subscription (Codex)',
  58: 'Advanced Custom',
  59: 'Sub2API',
  60: 'New API',
  61: 'SenseNova',
  62: 'OpenCode Zen',
} as const

const CHANNEL_TYPE_DISPLAY_ORDER: number[] = [
  1, 14, 33, 24, 43, 3, 41, 48, 60, 58, 42, 34, 20, 4, 40, 27, 25, 17, 26, 15,
  46, 23, 18, 45, 31, 35, 49, 19, 47, 37, 38, 39, 11, 8, 57, 59, 22, 21, 44, 2,
  5, 36, 50, 51, 52, 53, 54, 55, 56, 61, 62,
]

export const CHANNEL_TYPE_OPTIONS: { value: number; label: string }[] = (() => {
  const ordered: { value: number; label: string }[] = []
  const seen = new Set<number>()
  for (const id of CHANNEL_TYPE_DISPLAY_ORDER) {
    const label = CHANNEL_TYPES[id as keyof typeof CHANNEL_TYPES]
    if (label) {
      ordered.push({ value: id, label })
      seen.add(id)
    }
  }
  for (const [key, label] of Object.entries(CHANNEL_TYPES)) {
    const id = Number(key)
    if (id !== 0 && !seen.has(id)) {
      ordered.push({ value: id, label })
    }
  }
  return ordered
})()

// ============================================================================
// Coding-Plan Quota (余量监控挂在渠道上,仅查询,不影响转发)
// ============================================================================

// 编码套餐厂商下拉选项(label 是 i18n key)。
export const CODING_PLAN_PROVIDER_OPTIONS: {
  value: string
  label: string
}[] = [
  { value: 'zhipu', label: 'Zhipu (GLM) · China' },
  { value: 'zhipu_en', label: 'Zhipu (GLM) · International' },
  { value: 'kimi', label: 'Kimi For Coding' },
  { value: 'minimax', label: 'MiniMax · China' },
  { value: 'minimax_en', label: 'MiniMax · International' },
  { value: 'volcengine', label: 'Volcengine Ark' },
  { value: 'zenmux', label: 'ZenMux' },
]

// 手动/自定义渠道显式关闭余量监控的厂商值:即使 base_url 是套餐端点也不再自动绑定。
// 与后端 service.CodingPlanProviderDisabled("none") 保持一致。
export const CODING_PLAN_PROVIDER_DISABLED = 'none'

// 渠道类型 → 建议套餐厂商(仅表单自动建议,用户可改;与后端
// service.CodingPlanProviderFromChannelType 保持一致)。
export const CHANNEL_TYPE_CODING_PLAN_SUGGEST: Record<number, string> = {
  26: 'zhipu', // Zhipu V4
  25: 'kimi', // Moonshot
  35: 'minimax', // MiniMax
  45: 'volcengine', // VolcEngine
}

// 编码套餐专用端点符号键(label 是 i18n key),对齐后端 constant.ChannelSpecialBases。
// base_url 填这些符号键 → 渠道自动识别为对应编码套餐,转发走专用端点、余量自动可查。
export const CODING_PLAN_SYMBOL_OPTIONS: { value: string; label: string }[] = [
  { value: 'glm-coding-plan', label: 'Zhipu (GLM) · China' },
  { value: 'glm-coding-plan-international', label: 'Zhipu (GLM) · International' },
  { value: 'kimi-coding-plan', label: 'Kimi For Coding' },
  { value: 'minimax-coding-plan', label: 'MiniMax · China' },
  { value: 'minimax-coding-plan-international', label: 'MiniMax · International' },
  { value: 'doubao-coding-plan', label: 'Volcengine Ark' },
]

export const CODING_PLAN_SYMBOL_KEYS: string[] = CODING_PLAN_SYMBOL_OPTIONS.map(
  (option) => option.value
)

// 轻量前端探测:镜像后端 service.DetectCodingPlanProvider,供余量卡/琥珀标签在未显式
// 配置 coding_plan_provider 时,从 base_url 判断套餐厂商(符号键或套餐专用真实地址)。
// 只认套餐专用路径(如 /api/coding、/api/anthropic、kimi 的 /coding),避免把普通厂商
// host(如 open.bigmodel.cn 本体、api.anthropic.com)误判成套餐渠道。
export function detectCodingPlanProvider(
  baseUrl: string | null | undefined
): string | undefined {
  const url = (baseUrl ?? '').trim().toLowerCase()
  switch (url) {
    case 'glm-coding-plan':
      return 'zhipu'
    case 'glm-coding-plan-international':
      return 'zhipu_en'
    case 'kimi-coding-plan':
      return 'kimi'
    case 'minimax-coding-plan':
      return 'minimax'
    case 'minimax-coding-plan-international':
      return 'minimax_en'
    case 'doubao-coding-plan':
      return 'volcengine'
  }
  if (url.includes('api.kimi.com/coding')) return 'kimi'
  if (url.includes('volces.com/api/coding')) return 'volcengine'
  // MiniMax 套餐域就是 api.minimaxi.com / api.minimax.io(标准端点是 api.minimax.chat)。
  if (url.includes('api.minimaxi.com')) return 'minimax'
  if (url.includes('api.minimax.io')) return 'minimax_en'
  if (
    url.includes('open.bigmodel.cn/api/coding') ||
    url.includes('open.bigmodel.cn/api/anthropic')
  ) {
    return 'zhipu'
  }
  if (
    url.includes('api.z.ai/api/coding') ||
    url.includes('api.z.ai/api/anthropic')
  ) {
    return 'zhipu_en'
  }
  if (url.includes('zenmux')) return 'zenmux'
  return undefined
}

// 编码套餐可用的渠道类型 → base_url 预设(与火山渠道的地址选择器同款)。
// display 是下拉里展示的真实地址(i18n key,值即地址本身);value 是真正存进 base_url 的
// 值:编码套餐 OpenAI 端点存符号键(后端 ChannelSpecialBases 解析成真实端点),传统端点与
// Anthropic 兼容端点存真实地址。plan=true 表示该端点是编码套餐专用。provider 是选中该端点
// 后自动写入的套餐厂商(仅在余量查询用,不影响转发);不带的端点选中后清空厂商
// (传统端点 = 不启用余量监控)。顺序即下拉顺序,第一项是传统默认端点。
// Anthropic 兼容端点填「带 /v1/messages 的完整地址」,与 Custom 渠道同款:后端适配器
// 对已带 /v1/messages 的 base_url 直接透传,不自动拼路径(见各套餐适配器 GetRequestURL)。
export const CODING_PLAN_BASE_URL_PRESETS: Record<
  number,
  { value: string; display: string; plan: boolean; provider?: string }[]
> = {
  26: [
    { value: 'https://open.bigmodel.cn', display: 'https://open.bigmodel.cn', plan: false },
    {
      value: 'glm-coding-plan',
      display: 'https://open.bigmodel.cn/api/coding/paas/v4',
      plan: true,
      provider: 'zhipu',
    },
    {
      value: 'glm-coding-plan-international',
      display: 'https://api.z.ai/api/coding/paas/v4',
      plan: true,
      provider: 'zhipu_en',
    },
    // Anthropic 兼容端点:带 /v1/messages 的完整地址,后端原样透传。
    {
      value: 'https://open.bigmodel.cn/api/anthropic/v1/messages',
      display: 'https://open.bigmodel.cn/api/anthropic/v1/messages',
      plan: true,
      provider: 'zhipu',
    },
    {
      value: 'https://api.z.ai/api/anthropic/v1/messages',
      display: 'https://api.z.ai/api/anthropic/v1/messages',
      plan: true,
      provider: 'zhipu_en',
    },
  ],
  25: [
    { value: 'https://api.moonshot.cn', display: 'https://api.moonshot.cn', plan: false },
    {
      value: 'kimi-coding-plan',
      display: 'https://api.kimi.com/coding/v1',
      plan: true,
      provider: 'kimi',
    },
    {
      value: 'https://api.kimi.com/coding/v1/messages',
      display: 'https://api.kimi.com/coding/v1/messages',
      plan: true,
      provider: 'kimi',
    },
  ],
  35: [
    { value: 'https://api.minimax.chat', display: 'https://api.minimax.chat', plan: false },
    {
      value: 'minimax-coding-plan',
      display: 'https://api.minimaxi.com/v1',
      plan: true,
      provider: 'minimax',
    },
    {
      value: 'minimax-coding-plan-international',
      display: 'https://api.minimax.io/v1',
      plan: true,
      provider: 'minimax_en',
    },
    {
      value: 'https://api.minimaxi.com/anthropic/v1/messages',
      display: 'https://api.minimaxi.com/anthropic/v1/messages',
      plan: true,
      provider: 'minimax',
    },
    {
      value: 'https://api.minimax.io/anthropic/v1/messages',
      display: 'https://api.minimax.io/anthropic/v1/messages',
      plan: true,
      provider: 'minimax_en',
    },
  ],
}

// ============================================================================
// Channel Status (label values are i18n keys; use t(config.label) in components)
// ============================================================================

export const CHANNEL_STATUS = {
  UNKNOWN: 0,
  ENABLED: 1,
  MANUAL_DISABLED: 2,
  AUTO_DISABLED: 3,
} as const

export const CHANNEL_STATUS_LABELS = {
  [CHANNEL_STATUS.UNKNOWN]: 'Unknown',
  [CHANNEL_STATUS.ENABLED]: 'Enabled',
  [CHANNEL_STATUS.MANUAL_DISABLED]: 'Disabled',
  [CHANNEL_STATUS.AUTO_DISABLED]: 'Auto Disabled',
} as const

export const CHANNEL_STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
] as const

export const CHANNEL_STATUS_CONFIG = {
  [CHANNEL_STATUS.UNKNOWN]: {
    variant: 'neutral' as const,
    label: 'Unknown',
  },
  [CHANNEL_STATUS.ENABLED]: {
    variant: 'success' as const,
    label: 'Enabled',
  },
  [CHANNEL_STATUS.MANUAL_DISABLED]: {
    variant: 'danger' as const,
    label: 'Disabled',
  },
  [CHANNEL_STATUS.AUTO_DISABLED]: {
    variant: 'warning' as const,
    label: 'Auto Disabled',
  },
}

// ============================================================================
// Multi-Key Status
// ============================================================================

export const MULTI_KEY_STATUS = {
  ENABLED: 1,
  MANUAL_DISABLED: 2,
  AUTO_DISABLED: 3,
} as const

export const MULTI_KEY_STATUS_LABELS = {
  [MULTI_KEY_STATUS.ENABLED]: 'Enabled',
  [MULTI_KEY_STATUS.MANUAL_DISABLED]: 'Manual Disabled',
  [MULTI_KEY_STATUS.AUTO_DISABLED]: 'Auto Disabled',
} as const

export const MULTI_KEY_STATUS_CONFIG = {
  [MULTI_KEY_STATUS.ENABLED]: {
    variant: 'success' as const,
    label: 'Enabled',
  },
  [MULTI_KEY_STATUS.MANUAL_DISABLED]: {
    variant: 'neutral' as const,
    label: 'Manual Disabled',
  },
  [MULTI_KEY_STATUS.AUTO_DISABLED]: {
    variant: 'danger' as const,
    label: 'Auto Disabled',
  },
}

// ============================================================================
// Multi-Key Modes
// ============================================================================

export const MULTI_KEY_MODES = [
  { value: 'random', label: 'Random' },
  { value: 'polling', label: 'Polling' },
] as const

export const ADD_MODE_OPTIONS = [
  { value: 'single', label: 'Single Key' },
  { value: 'batch', label: 'Batch Add (one key per line)' },
  {
    value: 'multi_to_single',
    label: 'Multi-Key Mode (multiple keys, one channel)',
  },
] as const

// ============================================================================
// Multi-Key Management
// ============================================================================

export const MULTI_KEY_FILTER_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: '1', label: 'Enabled' },
  { value: '2', label: 'Manual Disabled' },
  { value: '3', label: 'Auto Disabled' },
] as const

export const MULTI_KEY_CONFIRM_MESSAGES = {
  DELETE:
    'Are you sure you want to delete this key? This action cannot be undone.',
  ENABLE: 'Enable this key?',
  DISABLE: 'Disable this key?',
  ENABLE_ALL: 'Are you sure you want to enable all keys?',
  DISABLE_ALL: 'Are you sure you want to disable all enabled keys?',
  DELETE_DISABLED:
    'Are you sure you want to delete all auto-disabled keys? This action cannot be undone.',
} as const

// ============================================================================
// Auto Ban Options
// ============================================================================

export const AUTO_BAN_OPTIONS = [
  { value: 1, label: 'Enabled' },
  { value: 0, label: 'Disabled' },
] as const

// ============================================================================
// Error / Success Messages (i18n keys: use t(ERROR_MESSAGES.xxx) when displaying)
// ============================================================================

export const ERROR_MESSAGES = {
  REQUIRED_NAME: 'Channel name is required',
  REQUIRED_TYPE: 'Channel type is required',
  REQUIRED_KEY: 'API key is required',
  REQUIRED_MODELS: 'Models are required',
  REQUIRED_GROUP: 'Group is required',
  INVALID_JSON: 'Invalid JSON format',
  INVALID_MODEL_MAPPING: 'Invalid model mapping format',
  INVALID_PROXY:
    'Proxy address must use HTTP, HTTPS, SOCKS5, or SOCKS5H and include a valid host',
  INVALID_HTTP_PROTOCOL: 'HTTP protocol must be Auto or HTTP/1.1',
  INVALID_HTTP2_CONNECTION_SHARDS:
    'HTTP/2 connection shards must be between 1 and 8',
  INVALID_HTTP1_WITH_SHARDS:
    'HTTP/2 connection shards must be 1 when HTTP/1.1 is selected',
  CREATE_FAILED: 'Failed to create channel',
  UPDATE_FAILED: 'Failed to update channel',
  DELETE_FAILED: 'Failed to delete channel',
  TEST_FAILED: 'Failed to test channel',
  BALANCE_QUERY_FAILED: 'Failed to query balance',
  FETCH_MODELS_FAILED: 'Failed to fetch models',
} as const

export const SUCCESS_MESSAGES = {
  CREATED: 'Channel created successfully',
  UPDATED: 'Channel updated successfully',
  DELETED: 'Channel deleted successfully',
  ENABLED: 'Channel enabled successfully',
  DISABLED: 'Channel disabled successfully',
  TESTED: 'Channel test completed',
  BALANCE_QUERIED: 'Balance queried successfully',
  MODELS_FETCHED: 'Models fetched successfully',
  COPIED: 'Channel copied successfully',
  TAG_SET: 'Tag set successfully',
  BATCH_DELETED: 'Channels deleted successfully',
} as const

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_PAGE_SIZE = 20

export const DEFAULT_CHANNEL_VALUES = {
  name: '',
  type: 0,
  base_url: '',
  key: '',
  models: '',
  group: 'default',
  status: CHANNEL_STATUS.ENABLED,
  priority: 0,
  weight: 0,
  auto_ban: 1,
  remark: '',
} as const

// ============================================================================
// Table Configuration
// ============================================================================

export const CHANNELS_TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// ============================================================================
// Sort Options (label values are i18n keys)
// ============================================================================

export const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority (Default)' },
  { value: 'id', label: 'ID' },
  { value: 'name', label: 'Name' },
  { value: 'balance', label: 'Balance' },
  { value: 'response_time', label: 'Response Time' },
] as const

// ============================================================================
// Balance Display
// ============================================================================

export const BALANCE_THRESHOLDS = {
  LOW: 1,
  MEDIUM: 10,
  HIGH: 100,
} as const

// ============================================================================
// Response Time Thresholds (in ms)
// ============================================================================

export const RESPONSE_TIME_THRESHOLDS = {
  EXCELLENT: 500,
  GOOD: 1000,
  FAIR: 2000,
  POOR: 5000,
} as const

export const RESPONSE_TIME_CONFIG = {
  EXCELLENT: { variant: 'success' as const, label: 'Excellent' },
  GOOD: { variant: 'success' as const, label: 'Good' },
  FAIR: { variant: 'warning' as const, label: 'Fair' },
  POOR: { variant: 'danger' as const, label: 'Poor' },
  UNKNOWN: { variant: 'neutral' as const, label: 'Not tested' },
} as const

// ============================================================================
// Field Hints and Placeholders (i18n keys; use t() when displaying)
// ============================================================================

export const FIELD_PLACEHOLDERS = {
  NAME: 'e.g., OpenAI GPT-4 Production',
  BASE_URL: 'Leave empty to use default',
  KEY: 'API Key (one per line for batch mode)',
  MODELS: 'Comma-separated model names, e.g., gpt-4,gpt-3.5-turbo',
  GROUP: 'Please Select user groups that can access this channel.',
  MODEL_MAPPING: '{"request_model": "actual_model"}',
  TEST_MODEL: 'Model to use for testing',
  TAG: 'Optional tag for grouping channels',
  REMARK: 'Optional notes about this channel',
  PARAM_OVERRIDE: '{"temperature": 0.7}',
  HEADER_OVERRIDE: '{"X-Custom-Header": "value"}',
  STATUS_CODE_MAPPING: '{"400": "500"}',
} as const

export const FIELD_DESCRIPTIONS = {
  NAME: 'Friendly name to identify this channel',
  TYPE: 'Provider type (OpenAI, Anthropic, etc.)',
  BASE_URL: 'Custom API base URL. Leave empty to use provider default.',
  KEY: 'API key from the provider',
  MODELS:
    'List of models supported by this channel. Use comma to separate multiple models.',
  GROUP: 'User groups that can access this channel. ',
  MODEL_MAPPING:
    'Map request model names to actual provider model names (JSON format)',
  PRIORITY: 'Higher priority channels are selected first',
  WEIGHT: 'Used for load balancing. Higher weight = more requests',
  TEST_MODEL: 'Model to use when testing channel connectivity',
  AUTO_BAN: 'Automatically disable channel on repeated failures',
  STATUS_CODE_MAPPING: 'Map response status codes (JSON format)',
  TAG: 'Group channels by tag for batch operations',
  REMARK: 'Internal notes (not shown to users)',
  SETTING: 'Channel-specific settings (JSON format)',
  PARAM_OVERRIDE: 'Override request parameters (JSON format)',
  HEADER_OVERRIDE: 'Override request headers (JSON format)',
  MULTI_KEY_MODE: 'How to select keys: random or sequential polling',
  BATCH_ADD: 'Create multiple channels from multiple keys',
  OPENAI_ORG: 'OpenAI Organization ID (optional)',
} as const

// ============================================================================
// Channel Type Specific Configurations
// ============================================================================

export const MODEL_FETCHABLE_TYPES = new Set([
  1, 4, 14, 17, 20, 23, 24, 25, 26, 27, 31, 34, 35, 40, 42, 43, 47, 48, 57, 58,
  59, 60, 62,
])

export const TYPE_TO_KEY_PROMPT: Record<number, string> = {
  15: 'Format: APIKey|SecretKey',
  18: 'Format: APPID|APISecret|APIKey',
  22: 'Format: APIKey-AppId, e.g., fastgpt-0sp2gtvfdgyi4k30jwlgwf1i-64f335d84283f05518e9e041',
  23: 'Format: TokenHub API Key, or legacy AppId|SecretId|SecretKey',
  33: 'Format: Ak|Sk|Region',
  50: 'Format: AccessKey|SecretKey (or just ApiKey if upstream is New API)',
  51: 'Format: Access Key ID|Secret Access Key',
  57: 'Paste Codex OAuth JSON credential (access_token / refresh_token / account_id)',
  59: 'Enter API key for this channel',
  60: 'Enter API key for this channel',
  62: 'Optional. Leave empty to use the free plan (anonymous), or fill in your OpenCode Zen API key for the paid plan',
}

export const CHANNEL_TYPE_WARNINGS: Record<number, string> = {
  3: 'For channels added after May 10, 2025, no need to remove "." from model names during deployment',
  8: 'If connecting to upstream One API or New API relay projects, use OpenAI type instead unless you know what you are doing',
  37: 'Dify channels only support chatflow and agent, and agent does not support images',
  62: 'No key = free plan (anonymous public access). Free models rotate; when a free promotion ends, the model returns an error. Fill in a key to use the paid plan.',
}
