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
import { RateLimitSection } from '../request-limits/rate-limit-section'
import { SensitiveWordsSection } from '../request-limits/sensitive-words-section'
import { SSRFSection } from '../request-limits/ssrf-section'
import { TokenLimitSection } from '../request-limits/token-limit-section'
import type { SecuritySettings } from '../types'
import { createSectionRegistry } from '../utils/section-registry'
import { RiskControlSection } from './risk-control-section'

const SECURITY_SECTIONS = [
  {
    id: 'rate-limit',
    titleKey: 'Rate Limiting',
    build: (settings: SecuritySettings) => (
      <RateLimitSection
        defaultValues={{
          ModelRequestRateLimitEnabled: settings.ModelRequestRateLimitEnabled,
          ModelRequestRateLimitCount: settings.ModelRequestRateLimitCount,
          ModelRequestRateLimitSuccessCount:
            settings.ModelRequestRateLimitSuccessCount,
          ModelRequestRateLimitDurationMinutes:
            settings.ModelRequestRateLimitDurationMinutes,
          ModelRequestRateLimitGroup: settings.ModelRequestRateLimitGroup,
          CriticalRateLimitEnable: settings.CriticalRateLimitEnable,
          CriticalRateLimitNum: settings.CriticalRateLimitNum,
          CriticalRateLimitDuration: settings.CriticalRateLimitDuration,
          GlobalApiRateLimitEnable: settings.GlobalApiRateLimitEnable,
          GlobalApiRateLimitNum: settings.GlobalApiRateLimitNum,
          GlobalApiRateLimitDuration: settings.GlobalApiRateLimitDuration,
          GlobalWebRateLimitEnable: settings.GlobalWebRateLimitEnable,
          GlobalWebRateLimitNum: settings.GlobalWebRateLimitNum,
          GlobalWebRateLimitDuration: settings.GlobalWebRateLimitDuration,
        }}
      />
    ),
  },
  {
    id: 'sensitive-words',
    titleKey: 'Sensitive Words',
    build: (settings: SecuritySettings) => (
      <SensitiveWordsSection
        defaultValues={{
          CheckSensitiveEnabled: settings.CheckSensitiveEnabled,
          CheckSensitiveOnPromptEnabled: settings.CheckSensitiveOnPromptEnabled,
          SensitiveWords: settings.SensitiveWords,
        }}
      />
    ),
  },
  {
    id: 'ssrf',
    titleKey: 'SSRF Protection',
    build: (settings: SecuritySettings) => (
      <SSRFSection
        defaultValues={{
          'fetch_setting.enable_ssrf_protection':
            settings['fetch_setting.enable_ssrf_protection'],
          'fetch_setting.allow_private_ip':
            settings['fetch_setting.allow_private_ip'],
          'fetch_setting.domain_filter_mode':
            settings['fetch_setting.domain_filter_mode'],
          'fetch_setting.ip_filter_mode':
            settings['fetch_setting.ip_filter_mode'],
          'fetch_setting.domain_list': settings['fetch_setting.domain_list'],
          'fetch_setting.ip_list': settings['fetch_setting.ip_list'],
          'fetch_setting.allowed_ports':
            settings['fetch_setting.allowed_ports'],
          'fetch_setting.apply_ip_filter_for_domain':
            settings['fetch_setting.apply_ip_filter_for_domain'],
        }}
      />
    ),
  },
  {
    id: 'token-limits',
    titleKey: 'Token Limits',
    build: (settings: SecuritySettings) => (
      <TokenLimitSection
        defaultValues={{
          'token_setting.max_user_tokens':
            settings['token_setting.max_user_tokens'],
        }}
      />
    ),
  },
  {
    id: 'risk-control',
    titleKey: 'Risk Control',
    build: (settings: SecuritySettings) => (
      <RiskControlSection
        defaultValues={{
          'credit_score_setting.enabled':
            settings['credit_score_setting.enabled'] ?? false,
          'credit_score_setting.auto_freeze_enabled':
            settings['credit_score_setting.auto_freeze_enabled'] ?? true,
          'credit_score_setting.full_score':
            settings['credit_score_setting.full_score'] ?? 650,
          'credit_score_setting.freeze_threshold':
            settings['credit_score_setting.freeze_threshold'] ?? 500,
          'credit_score_setting.deduction_upstream_violation':
            settings['credit_score_setting.deduction_upstream_violation'] ?? 5,
          'credit_score_setting.deduction_local_keyword':
            settings['credit_score_setting.deduction_local_keyword'] ?? 1,
          'credit_score_setting.violation_markers':
            settings['credit_score_setting.violation_markers'] ?? '',
          'credit_score_setting.repeat_multiplier_enabled':
            settings['credit_score_setting.repeat_multiplier_enabled'] ?? true,
          'credit_score_setting.max_daily_deduction':
            settings['credit_score_setting.max_daily_deduction'] ?? 50,
          'credit_score_setting.recover_enabled':
            settings['credit_score_setting.recover_enabled'] ?? true,
          'credit_score_setting.recover_per_day':
            settings['credit_score_setting.recover_per_day'] ?? 5,
          'credit_score_setting.pledge_points':
            settings['credit_score_setting.pledge_points'] ?? 10,
          'credit_score_setting.pledge_cooldown_days':
            settings['credit_score_setting.pledge_cooldown_days'] ?? 7,
          'credit_score_setting.marker_analysis_enabled':
            settings['credit_score_setting.marker_analysis_enabled'] ?? false,
          'credit_score_setting.marker_analysis_base_url':
            settings['credit_score_setting.marker_analysis_base_url'] ?? '',
          'credit_score_setting.marker_analysis_api_key':
            settings['credit_score_setting.marker_analysis_api_key'] ?? '',
          'credit_score_setting.marker_analysis_model':
            settings['credit_score_setting.marker_analysis_model'] ?? '',
          'conversation_retention_setting.enabled':
            settings['conversation_retention_setting.enabled'] ?? false,
          'conversation_retention_setting.request_max_bytes':
            settings['conversation_retention_setting.request_max_bytes'] ??
            2097152,
          'conversation_retention_setting.response_max_bytes':
            settings['conversation_retention_setting.response_max_bytes'] ??
            2097152,
          'conversation_retention_setting.max_total_bytes':
            settings['conversation_retention_setting.max_total_bytes'] ??
            5368709120,
          'conversation_retention_setting.ttl_days':
            settings['conversation_retention_setting.ttl_days'] ?? 30,
        }}
      />
    ),
  },
] as const

export type SecuritySectionId = (typeof SECURITY_SECTIONS)[number]['id']

const securityRegistry = createSectionRegistry<
  SecuritySectionId,
  SecuritySettings
>({
  sections: SECURITY_SECTIONS,
  defaultSection: 'rate-limit',
  basePath: '/system-settings/security',
  urlStyle: 'path',
})

export const SECURITY_SECTION_IDS = securityRegistry.sectionIds
export const SECURITY_DEFAULT_SECTION = securityRegistry.defaultSection
export const getSecuritySectionNavItems = securityRegistry.getSectionNavItems
export const getSecuritySectionContent = securityRegistry.getSectionContent
export const getSecuritySectionMeta = securityRegistry.getSectionMeta
