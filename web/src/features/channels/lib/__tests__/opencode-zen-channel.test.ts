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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

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

    assert.deepEqual(option, {
      value: CHANNEL_TYPE_OPENCODE_ZEN,
      label: 'OpenCode Zen',
    })
    assert.equal(MODEL_FETCHABLE_TYPES.has(CHANNEL_TYPE_OPENCODE_ZEN), true)
    assert.equal(getChannelTypeIcon(CHANNEL_TYPE_OPENCODE_ZEN), 'OpenCode')
    assert.equal(
      getChannelTypeConfig(CHANNEL_TYPE_OPENCODE_ZEN).defaultBaseUrl,
      'https://opencode.ai/zen'
    )
  })

  test('allows creating a channel with an empty key (free plan)', () => {
    const result = channelFormSchema.safeParse(openCodeZenForm(''))

    assert.equal(result.success, true)
  })

  test('still accepts a filled key (paid plan)', () => {
    const result = channelFormSchema.safeParse(openCodeZenForm('oc_zen_secret'))

    assert.equal(result.success, true)
  })

  test('explicitly clearing the key keeps it in the update payload', () => {
    const payload = transformFormDataToUpdatePayload(
      openCodeZenForm('', true),
      1
    )

    // '' is normalized to null by the empty-string cleanup; the backend
    // interprets a present key:null as "clear the saved key".
    assert.equal('key' in payload, true)
    assert.equal(payload.key == null, true)
  })

  test('empty key without the clear toggle keeps the existing key untouched', () => {
    const payload = transformFormDataToUpdatePayload(
      openCodeZenForm('', false),
      1
    )

    assert.equal('key' in payload, false)
  })
})
