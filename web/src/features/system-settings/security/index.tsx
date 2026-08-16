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
import { SettingsPage } from '../components/settings-page'
import type { SecuritySettings } from '../types'
import {
  SECURITY_DEFAULT_SECTION,
  getSecuritySectionContent,
  getSecuritySectionMeta,
} from './section-registry.tsx'

const defaultSecuritySettings: SecuritySettings = {
  ModelRequestRateLimitEnabled: false,
  ModelRequestRateLimitCount: 0,
  ModelRequestRateLimitSuccessCount: 1000,
  ModelRequestRateLimitDurationMinutes: 1,
  ModelRequestRateLimitGroup: '',
  CriticalRateLimitEnable: true,
  CriticalRateLimitNum: 20,
  CriticalRateLimitDuration: 1200,
  GlobalApiRateLimitEnable: true,
  GlobalApiRateLimitNum: 360,
  GlobalApiRateLimitDuration: 180,
  GlobalWebRateLimitEnable: true,
  GlobalWebRateLimitNum: 120,
  GlobalWebRateLimitDuration: 180,
  CheckSensitiveEnabled: false,
  CheckSensitiveOnPromptEnabled: false,
  SensitiveWords: '',
  'fetch_setting.enable_ssrf_protection': true,
  'fetch_setting.allow_private_ip': false,
  'fetch_setting.domain_filter_mode': false,
  'fetch_setting.ip_filter_mode': false,
  'fetch_setting.domain_list': [],
  'fetch_setting.ip_list': [],
  'fetch_setting.allowed_ports': [],
  'fetch_setting.apply_ip_filter_for_domain': false,
  'token_setting.max_user_tokens': 1000,
  'credit_score_setting.enabled': false,
  'credit_score_setting.auto_freeze_enabled': true,
  'credit_score_setting.full_score': 650,
  'credit_score_setting.freeze_threshold': 500,
  'credit_score_setting.deduction_upstream_violation': 5,
  'credit_score_setting.deduction_local_keyword': 1,
  'credit_score_setting.violation_markers':
    'Failed check: SAFETY_CHECK_TYPE\nContent violates usage guidelines\nis sensitive\nplease check your input',
  'credit_score_setting.repeat_multiplier_enabled': true,
  'credit_score_setting.max_daily_deduction': 50,
  'credit_score_setting.recover_enabled': true,
  'credit_score_setting.recover_per_day': 5,
  'credit_score_setting.pledge_points': 10,
  'credit_score_setting.pledge_cooldown_days': 7,
  'credit_score_setting.marker_analysis_enabled': false,
  'credit_score_setting.marker_analysis_base_url': '',
  'credit_score_setting.marker_analysis_api_key': '',
  'credit_score_setting.marker_analysis_model': '',
  'credit_score_setting.marker_analysis_internal_group': '',
  'credit_score_setting.marker_analysis_threshold_enabled': false,
  'credit_score_setting.marker_analysis_threshold_count': 150,
  'credit_score_setting.marker_analysis_request_interval_ms': 1000,
  'credit_score_setting.marker_analysis_prompt': '',
  'conversation_retention_setting.enabled': false,
  'conversation_retention_setting.request_max_bytes': 2097152,
  'conversation_retention_setting.response_max_bytes': 2097152,
  'conversation_retention_setting.max_total_bytes': 5368709120,
  'conversation_retention_setting.ttl_days': 30,
}

export function SecuritySettings() {
  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/security/$section'
      defaultSettings={defaultSecuritySettings}
      defaultSection={SECURITY_DEFAULT_SECTION}
      getSectionContent={getSecuritySectionContent}
      getSectionMeta={getSecuritySectionMeta}
    />
  )
}
