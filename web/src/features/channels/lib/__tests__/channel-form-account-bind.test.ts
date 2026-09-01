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
import { describe, expect, test } from 'vitest'

import { channelSchema, type Channel } from '../../types'
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  transformChannelToFormDefaults,
  transformFormDataToCreatePayload,
  transformFormDataToUpdatePayload,
  type ChannelFormValues,
} from '../channel-form'

function formWith(overrides: Partial<ChannelFormValues>): ChannelFormValues {
  return {
    ...CHANNEL_FORM_DEFAULT_VALUES,
    name: 'test-channel',
    type: 1,
    models: 'gpt-4o',
    group: ['default'],
    status: 1,
    key: 'sk-test-key',
    ...overrides,
  }
}

function channelWith(overrides: Partial<Channel>): Channel {
  return channelSchema.parse({
    id: 1,
    type: 1,
    key: 'sk-test',
    status: 1,
    name: 'test',
    created_time: 0,
    test_time: 0,
    response_time: 0,
    base_url: null,
    balance_updated_time: 0,
    ...overrides,
  })
}

describe('transformFormDataToCreatePayload — 绑定共享账户(凭证与渠道解耦)', () => {
  test('绑定账户:mode 强制 single,payload 携带 account_id,渠道不带凭证', () => {
    const payload = transformFormDataToCreatePayload(
      formWith({ account_id: 5, base_url: 'https://example.com' })
    )
    expect(payload.mode).toBe('single')
    expect(payload.account_id).toBe(5)
    // 凭证真相源在账户:渠道侧 key/base_url 收敛(空串经清理循环转 null)
    expect(payload.channel.key == null || payload.channel.key === '').toBe(true)
    expect(payload.channel.base_url).toBeNull()
  })

  test('绑定账户时残留 multi_to_single 模式:顶层 mode 仍为 single 且不传 multi_key_mode', () => {
    const payload = transformFormDataToCreatePayload(
      formWith({
        account_id: 7,
        multi_key_mode: 'multi_to_single',
        multi_key_type: 'polling',
      })
    )
    expect(payload.mode).toBe('single')
    expect(payload.multi_key_mode).toBeUndefined()
  })

  test('未绑定账户:保持原有行为(account_id 不出现,key 原样)', () => {
    const payload = transformFormDataToCreatePayload(formWith({}))
    expect(payload.mode).toBe('single')
    expect(payload.account_id).toBeUndefined()
    expect(payload.channel.key).toBe('sk-test-key')
  })
})

describe('transformChannelToFormDefaults — 编辑回填 account_id', () => {
  test('绑定账户的渠道:表单默认 account_id 回填渠道的账户 id', () => {
    const defaults = transformChannelToFormDefaults(
      channelWith({ account_id: 5 })
    )
    expect(defaults.account_id).toBe(5)
  })

  test('未绑定账户的渠道:account_id 为 null', () => {
    const defaults = transformChannelToFormDefaults(channelWith({ account_id: 0 }))
    expect(defaults.account_id).toBeNull()
  })
})

describe('transformFormDataToUpdatePayload — 编辑换绑/解绑 account_id', () => {
  test('绑定账户(含维持原账户):payload 携带 account_id', () => {
    const payload = transformFormDataToUpdatePayload(
      formWith({ account_id: 5 }),
      1
    )
    expect(payload.account_id).toBe(5)
  })

  test('解绑(选择不使用账户):account_id 传 0,后端视同解绑', () => {
    const payload = transformFormDataToUpdatePayload(
      formWith({ account_id: null }),
      1
    )
    expect(payload.account_id).toBe(0)
  })
})
