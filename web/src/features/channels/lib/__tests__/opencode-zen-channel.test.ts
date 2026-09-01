// @muw-owned
import { describe, expect, test } from 'vitest'

import {
  CHANNEL_TYPE_OPENCODE_ZEN,
  CHANNEL_TYPE_OPTIONS,
  MODEL_FETCHABLE_TYPES,
} from '../../constants'
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  channelFormSchema,
  transformFormDataToUpdatePayload,
} from '../channel-form'
import { getChannelTypeConfig } from '../channel-type-config'
import { getChannelTypeIcon } from '../channel-utils'

function openCodeZenForm(key: string, clearKey = false) {
  return {
    ...CHANNEL_FORM_DEFAULT_VALUES,
    name: 'OpenCode Zen',
    type: CHANNEL_TYPE_OPENCODE_ZEN,
    key,
    opencodezen_clear_key: clearKey,
    models: 'gpt-5,claude-sonnet-4-5',
  }
}

describe('OpenCode Zen channel', () => {
  test('registers selection, ordering, model discovery, and icon metadata', () => {
    const option = CHANNEL_TYPE_OPTIONS.find(
      (item) => item.value === CHANNEL_TYPE_OPENCODE_ZEN
    )

    expect(option).toEqual({
      value: CHANNEL_TYPE_OPENCODE_ZEN,
      label: 'OpenCode Zen',
    })
    expect(MODEL_FETCHABLE_TYPES.has(CHANNEL_TYPE_OPENCODE_ZEN)).toBe(true)
    expect(getChannelTypeIcon(CHANNEL_TYPE_OPENCODE_ZEN)).toBe('OpenCode')
    expect(
      getChannelTypeConfig(CHANNEL_TYPE_OPENCODE_ZEN).defaultBaseUrl
    ).toBe('https://opencode.ai/zen')
  })

  test('allows creating a channel with an empty key (free plan)', () => {
    const result = channelFormSchema.safeParse(openCodeZenForm(''))

    expect(result.success).toBe(true)
  })

  test('still accepts a filled key (paid plan)', () => {
    const result = channelFormSchema.safeParse(openCodeZenForm('oc_zen_secret'))

    expect(result.success).toBe(true)
  })

  test('explicitly clearing the key keeps it in the update payload', () => {
    const payload = transformFormDataToUpdatePayload(
      openCodeZenForm('', true),
      1
    )

    // '' is normalized to null by the empty-string cleanup; the backend
    // interprets a present key:null as "clear the saved key".
    expect('key' in payload).toBe(true)
    expect(payload.key == null).toBe(true)
  })

  test('empty key without the clear toggle keeps the existing key untouched', () => {
    const payload = transformFormDataToUpdatePayload(
      openCodeZenForm('', false),
      1
    )

    expect('key' in payload).toBe(false)
  })
})
