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

import {
  CHANNEL_FORM_DEFAULT_VALUES,
  transformFormDataToCreatePayload,
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
