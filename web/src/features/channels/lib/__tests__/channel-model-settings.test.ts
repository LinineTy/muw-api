import { describe, expect, it } from 'vitest'

import {
  channelFormSchema,
  serializeModelSettings,
  syncModelSettings,
} from '../channel-form'
import type { ChannelModelSettingForm } from '../../types'

describe('syncModelSettings', () => {
  it('keeps rows still selected and drops deselected ones', () => {
    const settings: ChannelModelSettingForm[] = [
      { model: 'gpt-4o', enabled: true, context_window: null },
      { model: 'gpt-4o-mini', enabled: false, context_window: 64000 },
      { model: 'gpt-3.5-turbo', enabled: true, context_window: null },
    ]
    const result = syncModelSettings(settings, ['gpt-4o', 'gpt-3.5-turbo'])
    expect(result.map((s) => s.model)).toEqual(['gpt-4o', 'gpt-3.5-turbo'])
    expect(result[0]).toEqual({
      model: 'gpt-4o',
      enabled: true,
      context_window: null,
    })
  })

  it('does not add default rows for newly selected models (unset = default)', () => {
    const result = syncModelSettings(
      [{ model: 'gpt-4o', enabled: true, context_window: null }],
      ['gpt-4o', 'claude-3-opus']
    )
    expect(result).toEqual([
      { model: 'gpt-4o', enabled: true, context_window: null },
    ])
  })

  it('preserves disabled flag and context override when model is kept', () => {
    const result = syncModelSettings(
      [{ model: 'gpt-4o', enabled: false, context_window: 128000 }],
      ['gpt-4o']
    )
    expect(result).toEqual([
      { model: 'gpt-4o', enabled: false, context_window: 128000 },
    ])
  })
})

describe('serializeModelSettings', () => {
  it('returns empty array for empty input', () => {
    expect(serializeModelSettings(undefined)).toEqual([])
    expect(serializeModelSettings([])).toEqual([])
  })

  it('normalizes undefined context_window to null', () => {
    expect(
      serializeModelSettings([
        { model: 'gpt-4o', enabled: true, context_window: undefined },
        { model: 'gpt-4o-mini', enabled: false, context_window: 64000 },
      ])
    ).toEqual([
      { model: 'gpt-4o', enabled: true, context_window: null },
      { model: 'gpt-4o-mini', enabled: false, context_window: 64000 },
    ])
  })
})

describe('channelFormSchema.model_settings', () => {
  it('accepts serialized form values (null context means inherit)', () => {
    const result = channelFormSchema.shape.model_settings.safeParse([
      { model: 'gpt-4o', enabled: false, context_window: null },
      { model: 'gpt-4o-mini', enabled: true, context_window: 64000 },
    ])
    expect(result.success).toBe(true)
  })

  it('accepts a full edit form after toggling a model off and saving', () => {
    const result = channelFormSchema.safeParse(buildEditForm('sk-test', false))
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.log(
        'validation issues:',
        result.error.issues.map((i) => ({ path: i.path, message: i.message }))
      )
    }
    expect(result.success).toBe(true)
  })

  it('accepts a full edit form with empty key (edit mode keeps key blank)', () => {
    const result = channelFormSchema.safeParse(buildEditForm('', false))
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.log(
        'key-empty issues:',
        result.error.issues.map((i) => ({ path: i.path, message: i.message }))
      )
    }
    expect(result.success).toBe(true)
  })
})

function buildEditForm(key: string, deepseekDisabled: boolean) {
  return {
    name: 'test-channel',
    type: 1,
    base_url: '',
    key,
    openai_organization: '',
    models: 'gpt-4o,gpt-4o-mini',
    group: ['default', 'svip', 'vip'],
    model_mapping: '',
    priority: 0,
    weight: 0,
    test_model: '',
    auto_ban: 1,
    status: 1,
    status_code_mapping: '',
    tag: '',
    remark: '',
    coding_plan_provider: '',
    coding_plan_key: '',
    coding_plan_key_clear: false,
    coding_plan_key_masked: '',
    setting: '',
    param_override: '',
    header_override: '',
    settings: '{}',
    other: '',
    multi_key_mode: 'single',
    multi_key_type: 'random',
    batch_add_set_key_prefix_2_name: false,
    key_mode: 'append',
    force_format: false,
    thinking_to_content: false,
    proxy: '',
    http_protocol: 'auto',
    http2_connection_shards: 1,
    pass_through_body_enabled: false,
    system_prompt: '',
    system_prompt_override: false,
    is_enterprise_account: false,
    vertex_key_type: 'json',
    aws_key_type: 'ak_sk',
    azure_responses_version: '',
    opencodezen_clear_key: false,
    allow_service_tier: false,
    disable_store: false,
    allow_safety_identifier: false,
    allow_include_obfuscation: false,
    allow_inference_geo: false,
    allow_speed: false,
    claude_beta_query: false,
    disable_task_polling_sleep: false,
    sensenova_remove_watermark: false,
    upstream_model_update_check_enabled: false,
    upstream_model_update_auto_sync_enabled: false,
    upstream_model_update_ignored_models: '',
    advanced_custom: '',
    model_settings: [
      { model: 'gpt-4o', enabled: deepseekDisabled, context_window: null },
      { model: 'gpt-4o-mini', enabled: true, context_window: null },
    ],
  }
}
