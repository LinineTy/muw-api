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
/**
 * Maps an option key (the flat key the frontend posts via PUT /api/option/,
 * e.g. `credit_score_setting.marker_analysis_internal_group`) to the i18n
 * label key its settings form already uses. Audit logs record only the raw
 * option key; the UI resolves it here so `修改系统设置` entries read like
 * `修改系统设置 标记分析分组` instead of exposing the internal key.
 *
 * Follows the CHANNEL_FIELD_LABELS precedent (backend stores language-neutral
 * tokens, frontend maps them to i18n labels at render time). Unknown/dynamic
 * keys (model names, group names, ...) simply fall back to the raw key.
 *
 * Keep this in sync with `web/src/features/system-settings/` form labels.
 */
export const OPTION_KEY_LABELS: Record<string, string> = {
  // ---- 安全 · 风控（security/risk-control-section.tsx）----
  'credit_score_setting.enabled': 'Enable credit score system',
  'credit_score_setting.auto_freeze_enabled': 'Auto-freeze below threshold',
  'credit_score_setting.full_score': 'Full score',
  'credit_score_setting.freeze_threshold': 'Freeze threshold',
  'credit_score_setting.deduction_upstream_violation':
    'Deduction per upstream violation',
  'credit_score_setting.deduction_local_keyword':
    'Deduction per sensitive-word hit',
  'credit_score_setting.violation_markers': 'Upstream violation markers',
  'credit_score_setting.repeat_multiplier_enabled':
    'Repeat violation escalation',
  'credit_score_setting.repeat_multiplier_tiers': 'Repeat multiplier tiers',
  'credit_score_setting.max_daily_deduction': 'Max daily deduction',
  'credit_score_setting.recover_enabled': 'Enable passive recovery',
  'credit_score_setting.recover_per_day': 'Points recovered per day',
  'credit_score_setting.pledge_points': 'Points per pledge',
  'credit_score_setting.pledge_cooldown_days': 'Pledge cooldown (days)',
  'credit_score_setting.marker_analysis_enabled': 'Enable AI marker analysis',
  'credit_score_setting.marker_analysis_threshold_enabled':
    'Threshold-based analysis',
  'credit_score_setting.marker_analysis_threshold_count':
    'Trigger threshold (unanalyzed errors)',
  'credit_score_setting.marker_analysis_prompt': 'Marker analysis prompt',
  'credit_score_setting.marker_analysis_request_interval_ms':
    'Request interval between analysis calls (ms)',
  'credit_score_setting.marker_analysis_base_url':
    'Marker analysis API base URL',
  'credit_score_setting.marker_analysis_api_key': 'Marker analysis API key',
  'credit_score_setting.marker_analysis_model': 'Marker analysis model',
  'credit_score_setting.marker_analysis_internal_group':
    'Marker analysis group',
  'conversation_retention_setting.enabled':
    'Record conversation requests & responses',
  'conversation_retention_setting.request_max_bytes': 'Max request size (MB)',
  'conversation_retention_setting.response_max_bytes': 'Max response size (MB)',
  'conversation_retention_setting.max_total_bytes': 'Max total storage (GB)',
  'conversation_retention_setting.ttl_days': 'Retention (days)',

  // ---- 运营 · 视觉兜底（operations/visual-fallback-section.tsx）----
  'visual_fallback_setting.enabled':
    'Enable vision fallback for non-vision models',
  'visual_fallback_setting.model': 'Vision fallback model',
  'visual_fallback_setting.prompt': 'Vision description prompt',
  'visual_fallback_setting.supported_models': 'Vision-capable models',

  // ---- 认证 · 基础认证（auth/basic-auth-section.tsx）----
  PasswordLoginEnabled: 'Password Login',
  RegisterEnabled: 'Registration Enabled',
  PasswordRegisterEnabled: 'Password Registration',
  EmailVerificationEnabled: 'Email Verification',
  EmailDomainRestrictionEnabled: 'Email Domain Restriction',
  EmailAliasRestrictionEnabled: 'Email Alias Restriction',
  EmailDomainWhitelist: 'Email Domain Whitelist',
  MaxUserCount: 'Maximum Users',

  // ---- 认证 · 机器人防护（auth/bot-protection-section.tsx）----
  TurnstileCheckEnabled: 'Enable Turnstile',
  TurnstileSiteKey: 'Site Key',
  TurnstileSecretKey: 'Secret Key',

  // ---- 认证 · Passkey（auth/passkey-section.tsx）----
  'passkey.enabled': 'Enable Passkey',
  'passkey.rp_display_name': 'Relying Party Display Name',
  'passkey.rp_id': 'Relying Party ID',
  'passkey.user_verification': 'User Verification',
  'passkey.attachment_preference': 'Device Type Preference',
  'passkey.allow_insecure_origin': 'Allow Insecure Origins',
  'passkey.origins': 'Allowed Origins',

  // ---- 认证 · OAuth（auth/oauth-section.tsx）----
  GitHubOAuthEnabled: 'Enable GitHub OAuth',
  GitHubClientId: 'Client ID',
  GitHubClientSecret: 'Client Secret',
  'discord.enabled': 'Enable Discord OAuth',
  'discord.client_id': 'Client ID',
  'discord.client_secret': 'Client Secret',
  'oidc.enabled': 'Enable OIDC',
  'oidc.display_name': 'OIDC Display Name',
  'oidc.client_id': 'Client ID',
  'oidc.client_secret': 'Client Secret',
  'oidc.well_known': 'Well-Known URL',
  'oidc.authorization_endpoint': 'Authorization Endpoint (Optional)',
  'oidc.token_endpoint': 'Token Endpoint (Optional)',
  'oidc.user_info_endpoint': 'User Info Endpoint (Optional)',
  TelegramOAuthEnabled: 'Enable Telegram OAuth',
  TelegramBotToken: 'Bot Token',
  TelegramBotName: 'Bot Name',
  LinuxDOOAuthEnabled: 'Enable LinuxDO OAuth',
  LinuxDOClientId: 'Client ID',
  LinuxDOClientSecret: 'Client Secret',
  LinuxDOMinimumTrustLevel: 'Minimum Trust Level',
  LinuxDOGroupMapping: 'Trust Level Group Mapping',
  LinuxDOBlacklist: 'LinuxDO Blacklist',
  LinuxDoRefreshEnabled: 'Refresh LinuxDO trust levels',
  LinuxDoRefreshIntervalHours: 'Refresh interval (hours)',
  WeChatAuthEnabled: 'Enable WeChat Auth',
  WeChatServerAddress: 'Server Address',
  WeChatServerToken: 'Server Token',
  WeChatAccountQRCodeImageURL: 'QR Code Image URL',

  // ---- 通用（general/system-behavior-section.tsx / system-info-section.tsx）----
  DefaultCollapseSidebar: 'Default Collapse Sidebar',
  DemoSiteEnabled: 'Demo Site Mode',
  SelfUseModeEnabled: 'Self-Use Mode',
  AffiliateProgramEnabled: 'Referral Program',
  DefaultUserGroup: 'Default User Group',
  SystemName: 'System Name',
  ServerAddress: 'Server Address',
  Logo: 'Logo URL',
  BackgroundImage: 'Background image URL',
  GlassMaskOpacity: 'Background image mask',
  GlassBrightness: 'Background brightness',
  Footer: 'Footer',

  // ---- 通用 · 额度（general/quota-settings-section.tsx）----
  QuotaForNewUser: 'New User Quota',
  PreConsumedQuota: 'Pre-Consumed Quota',
  QuotaForInviter: 'Inviter Reward',
  QuotaForInvitee: 'Invitee Reward',
  'quota_setting.enable_free_model_pre_consume': 'Pre-Consume for Free Models',
  TopUpLink: 'Top-Up Link',
  'general_setting.docs_link': 'Documentation Link',

  // ---- 通用 · 定价（general/pricing-section.tsx）----
  QuotaPerUnit: 'Quota Per Unit',
  'general_setting.quota_display_type': 'Display Mode',
  USDExchangeRate: 'USD Exchange Rate',
  'general_setting.custom_currency_symbol': 'Custom Currency Symbol',
  'general_setting.custom_currency_exchange_rate': 'Units per USD',
  DisplayInCurrencyEnabled: 'Display in Currency',
  DisplayTokenStatEnabled: 'Display Token Statistics',

  // ---- 通用 · 偏好策略（general/user-preference-policy-section.tsx）----
  UserPreferencePolicy: 'User Preference Policy',

  // ---- 通用 · 额度池（general/quota-pool-settings-section.tsx）----
  'quota_pool_setting.enabled': 'Enable Quota Pool',
  'quota_pool_setting.pool_period': 'Global Period',
  'quota_pool_setting.user_period': 'User Period',
  'quota_pool_setting.amount_type': 'Amount Type',
  'quota_pool_setting.amount': 'Claim Amount',
  'quota_pool_setting.min_amount': 'Minimum Claim Amount',
  'quota_pool_setting.max_amount': 'Maximum Claim Amount',
  'quota_pool_setting.pool_period_cap': 'Global Period Cap',
  'quota_pool_setting.user_period_cap': 'User Period Cap',
  'quota_pool_setting.user_period_count_limit': 'Claim Count Limit',
  'quota_pool_setting.balance_mode': 'Balance Requirement',
  'quota_pool_setting.balance_limit': 'Balance Threshold',
  'quota_pool_setting.time_rule': 'Time Rule',

  // ---- 通用 · 渠道亲和（general/channel-affinity/index.tsx）----
  'channel_affinity_setting.enabled': 'Enable',
  'channel_affinity_setting.max_entries': 'Max Entries',
  'channel_affinity_setting.default_ttl_seconds': 'Default TTL (seconds)',
  'channel_affinity_setting.switch_on_success': 'Switch affinity on success',
  'channel_affinity_setting.keep_on_channel_disabled':
    'Keep affinity when channel is disabled',
  'channel_affinity_setting.rules': 'Rules JSON',

  // ---- 模型 · 全局（models/global-settings-card.tsx）----
  'global.pass_through_request_enabled': 'Enable Request Passthrough',
  'global.thinking_model_blacklist':
    'Models that skip thinking suffix processing',
  'global.chat_completions_to_responses_policy': 'Policy JSON',
  'general_setting.ping_interval_enabled': 'Keep-alive Ping',
  'general_setting.ping_interval_seconds': 'Ping Interval (seconds)',

  // ---- 模型 · Grok（models/grok-settings-card.tsx）----
  'grok.violation_deduction_enabled': 'Enable violation deduction',
  'grok.violation_deduction_amount': 'Violation deduction amount',

  // ---- 模型 · Claude（models/claude-settings-card.tsx）----
  'claude.model_headers_settings': 'Request Header Overrides',
  'claude.default_max_tokens': 'Default Max Tokens',
  'claude.thinking_adapter_enabled': 'Thinking Suffix Adapter',
  'claude.thinking_adapter_budget_tokens_percentage': 'Budget Tokens Ratio',

  // ---- 模型 · Gemini（models/gemini-settings-card.tsx）----
  'gemini.safety_settings': 'Safety Settings',
  'gemini.version_settings': 'Version Overrides',
  'gemini.supported_imagine_models': 'Supported Imagine Models',
  'gemini.thinking_adapter_enabled': 'Thinking Suffix Adapter',
  'gemini.thinking_adapter_budget_tokens_percentage': 'Budget Tokens Ratio',
  'gemini.function_call_thought_signature_enabled':
    'Enable FunctionCall thoughtSignature Fill',
  'gemini.remove_function_response_id_enabled':
    'Remove functionResponse.id field',

  // ---- 模型 · 倍率（models/ratio-settings-card.tsx）----
  ModelPrice: 'Model fixed pricing',
  ModelRatio: 'Model ratio',
  CacheRatio: 'Prompt cache ratio',
  CreateCacheRatio: 'Create cache ratio',
  CompletionRatio: 'Completion ratio',
  ImageRatio: 'Image ratio',
  AudioRatio: 'Audio ratio',
  AudioCompletionRatio: 'Audio completion ratio',
  ExposeRatioEnabled: 'Expose ratio API',
  'billing_setting.billing_mode': 'Pricing mode',
  'billing_setting.billing_expr': 'Billing expression',

  // ---- 模型 · 分组倍率（models/ratio-settings-card.tsx）----
  GroupRatio: 'Group ratios',
  TopupGroupRatio: 'Top-up group ratios',
  UserUsableGroups: 'Selectable groups',
  GroupGroupRatio: 'Inter-group overrides',
  AutoGroups: 'Auto assignment order',
  MaxTokenAutoGroups: 'Maximum custom groups per token',
  DefaultUseAutoGroup: 'Default to auto groups',
  'group_ratio_setting.group_special_usable_group':
    'Special usable group rules',

  // ---- 模型 · 工具价格（models/tool-price-settings.tsx）----
  'tool_price_setting.prices': 'Tool prices',

  // ---- 模型 · 订阅（models/subscription-settings-section.tsx）----
  SubscriptionAutoRenewEnabled: 'Auto-renew',
  SubscriptionPriorityEnabled: 'Consumption priority',
  SubscriptionGroupUpgradeEnabled: 'User group upgrade / downgrade',
  SubscriptionExclusiveGroupEnabled: 'Mutual-exclusion groups',
  SubscriptionMaxSimultaneous: 'Max simultaneous subscriptions',

  // ---- 模型 · 路由可靠性（models/routing-reliability-section.tsx）----
  RetryTimes: 'Retry Times',
  AutomaticRetryStatusCodes: 'Auto-retry status codes',
  'monitor_setting.auto_test_channel_enabled': 'Scheduled channel tests',
  'monitor_setting.auto_test_all_models': 'Test all models of each channel',
  'monitor_setting.record_user_traffic': 'Record real user traffic',
  'monitor_setting.channel_test_mode': 'Channel test mode',
  'monitor_setting.auto_test_channel_minutes': 'Test interval (minutes)',
  AutomaticEnableChannelEnabled: 'Re-enable on success',
  AutomaticDisableChannelEnabled: 'Disable on failure',
  ChannelDisableThreshold: 'Disable threshold (seconds)',
  AutomaticDisableStatusCodes: 'Auto-disable status codes',
  AutomaticDisableKeywords: 'Failure keywords',

  // ---- 内容（content/*）----
  'console_setting.announcements_enabled': 'Enabled',
  'console_setting.announcements': 'Announcements',
  'console_setting.api_info_enabled': 'Enabled',
  'console_setting.api_info': 'API Addresses',
  Chats: 'Chat configuration JSON',
  DataExportEnabled: 'Enable Data Dashboard',
  DataExportInterval: 'Refresh interval (minutes)',
  DataExportDefaultTime: 'Default time granularity',
  DrawingEnabled: 'Enable drawing features',
  MjNotifyEnabled: 'Allow upstream callbacks',
  MjAccountFilterEnabled: 'Allow accountFilter parameter',
  MjForwardUrlEnabled: 'Rewrite callback URLs to the local server',
  MjModeClearEnabled: 'Clear mode flags in prompts',
  MjActionCheckSuccessEnabled: 'Require job success before follow-up actions',
  'console_setting.faq_enabled': 'Enabled',
  'console_setting.faq': 'FAQ',
  UserSpaceInitialMB: 'Initial storage per user (MB)',
  UserSpacePurchaseRatio: 'Purchase ratio (quota per MB)',
  UserSpaceMaxPurchaseMB: 'Max purchase per order (MB)',
  UserSpaceMaxPurchasedMB: 'Max purchased per user (MB)',
  UserSpaceGlobalMaxMB: 'Cloud space total allocation (MB)',
  PlaygroundImageTTLDays: 'Temporary image TTL (days)',
  'console_setting.system_load_enabled': 'Show system load on the dashboard',
  'console_setting.uptime_kuma_enabled': 'Enabled',
  'console_setting.uptime_kuma_groups': 'Uptime Kuma',

  // ---- 集成 · 邮件（integrations/email-settings-section.tsx）----
  SMTPServer: 'SMTP Host',
  SMTPPort: 'Port',
  SMTPAccount: 'Username',
  SMTPFrom: 'From Address',
  SMTPToken: 'Password / Access Token',
  SMTPSSLEnabled: 'SMTP encryption',
  SMTPStartTLSEnabled: 'SMTP encryption',
  SMTPInsecureSkipVerify: 'Skip SMTP TLS certificate verification',
  SMTPForceAuthLogin: 'Force AUTH LOGIN',

  // ---- 集成 · 监控（integrations/monitoring-settings-section.tsx）----
  QuotaRemindThreshold: 'Quota reminder (tokens)',
  'perf_metrics_setting.enabled': 'Enable model performance metrics',
  'perf_metrics_setting.flush_interval': 'Flush interval (minutes)',
  'perf_metrics_setting.bucket_time': 'Aggregation bucket',
  'perf_metrics_setting.retention_days': 'Retention days',

  // ---- 集成 · 支付（integrations/payment-settings-section.tsx）----
  Price: 'Price (local currency / USD)',
  MinTopUp: 'Minimum top-up (USD)',
  PayMethods: 'Payment methods',
  'payment_setting.amount_options': 'Top-up amount options',
  'payment_setting.amount_discount': 'Amount discount',
  PayAddress: 'Epay endpoint',
  CustomCallbackAddress: 'Callback address',
  EpayId: 'Epay merchant ID',
  EpayKey: 'Epay secret key',

  // ---- 集成 · Worker（integrations/worker-settings-section.tsx）----
  WorkerUrl: 'Worker URL',
  WorkerValidKey: 'Worker Access Key',
  WorkerAllowHttpImageRequestEnabled: 'Allow HTTP image requests',

  // ---- 安全 · 限流（request-limits/rate-limit-section.tsx）----
  ModelRequestRateLimitEnabled: 'Enable rate limiting',
  ModelRequestRateLimitDurationMinutes: 'Limit period',
  ModelRequestRateLimitCount: 'Max requests per period',
  ModelRequestRateLimitSuccessCount: 'Max successful requests',
  ModelRequestRateLimitGroup: 'Group-based rate limits',
  CriticalRateLimitEnable: 'Critical Rate Limit',
  CriticalRateLimitNum: 'Max requests',
  CriticalRateLimitDuration: 'Time window (minutes)',
  GlobalApiRateLimitEnable: 'Global API Rate Limit',
  GlobalApiRateLimitNum: 'Max requests',
  GlobalApiRateLimitDuration: 'Time window (minutes)',
  GlobalWebRateLimitEnable: 'Global Web Rate Limit',
  GlobalWebRateLimitNum: 'Max requests',
  GlobalWebRateLimitDuration: 'Time window (minutes)',

  // ---- 安全 · 敏感词（request-limits/sensitive-words-section.tsx）----
  CheckSensitiveEnabled: 'Enable filtering',
  CheckSensitiveOnPromptEnabled: 'Inspect user prompts',
  StopOnSensitiveEnabled: 'Block the request on hit',
  SensitiveWords: 'Blocked keywords',

  // ---- 安全 · SSRF（request-limits/ssrf-section.tsx）----
  'fetch_setting.enable_ssrf_protection': 'Enable SSRF Protection',
  'fetch_setting.allow_private_ip': 'Allow Private IPs',
  'fetch_setting.domain_filter_mode': 'Domain Filter Mode',
  'fetch_setting.domain_list': 'Domain filter list',
  'fetch_setting.ip_filter_mode': 'IP Filter Mode',
  'fetch_setting.ip_list': 'IP filter list',
  'fetch_setting.allowed_ports': 'Allowed Ports',
  'fetch_setting.apply_ip_filter_for_domain':
    'Apply IP Filter to Resolved Domains',

  // ---- 安全 · Token 上限（request-limits/token-limit-section.tsx）----
  'token_setting.max_user_tokens': 'Maximum tokens per user',

  // ---- 维护（maintenance/*）----
  HeaderNavModules: 'Header navigation',
  LogConsumeEnabled: 'Record quota usage',
  'console_setting.announcement_popup_enabled':
    'Show announcement popup automatically',
  'console_setting.announcement_popup_duration': 'Countdown (seconds)',
  Notice: 'Announcement content',
  'performance_setting.disk_cache_enabled': 'Enable Disk Cache',
  'performance_setting.disk_cache_threshold_mb': 'Disk Cache Threshold (MB)',
  'performance_setting.disk_cache_max_size_mb': 'Max Disk Cache Size (MB)',
  'performance_setting.disk_cache_path': 'Cache Directory',
  'performance_setting.monitor_enabled': 'Enable Performance Monitoring',
  'performance_setting.monitor_cpu_threshold': 'CPU Threshold (%)',
  'performance_setting.monitor_memory_threshold': 'Memory Threshold (%)',
  'performance_setting.monitor_disk_threshold': 'Disk Threshold (%)',
  SidebarModulesAdmin: 'Sidebar modules',
}
