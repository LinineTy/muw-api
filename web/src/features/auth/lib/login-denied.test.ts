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

import { buildLoginDeniedSearch, getLoginDeniedInfo } from './login-denied'

function deniedPayload(overrides: Record<string, unknown> = {}) {
  return {
    success: false,
    code: 'AUTH_LOGIN_DENIED',
    message: 'denied',
    data: {
      login_status: { status: 'user_disabled', reason: 'violated terms' },
    },
    ...overrides,
  }
}

describe('getLoginDeniedInfo', () => {
  test('parses a structured denial with a reason', () => {
    expect(getLoginDeniedInfo(deniedPayload())).toEqual({
      status: 'user_disabled',
      reason: 'violated terms',
    })
  })

  test('omits reason when it is empty', () => {
    const payload = deniedPayload({
      data: { login_status: { status: 'linuxdo_blacklisted', reason: '' } },
    })
    expect(getLoginDeniedInfo(payload)).toEqual({
      status: 'linuxdo_blacklisted',
    })
  })

  test('returns null when login_status is absent', () => {
    expect(getLoginDeniedInfo({ success: true, data: { user: {} } })).toBeNull()
  })

  test('parses the axios error shape response.data', () => {
    expect(
      getLoginDeniedInfo({ isAxiosError: true, response: { data: deniedPayload() } })
    ).toEqual({ status: 'user_disabled', reason: 'violated terms' })
  })

  test('keeps unknown statuses for forward compatibility', () => {
    const payload = deniedPayload({
      data: { login_status: { status: 'some_future_status' } },
    })
    expect(getLoginDeniedInfo(payload)).toEqual({
      status: 'some_future_status',
    })
  })

  test('returns null when status is not a non-empty string', () => {
    const payload = deniedPayload({
      data: { login_status: { status: '' } },
    })
    expect(getLoginDeniedInfo(payload)).toBeNull()
  })
})

describe('buildLoginDeniedSearch', () => {
  test('carries status, reason and message', () => {
    expect(
      buildLoginDeniedSearch(
        { status: 'user_disabled', reason: 'violated terms' },
        'denied message',
        '/dashboard'
      )
    ).toEqual({
      status: 'user_disabled',
      reason: 'violated terms',
      message: 'denied message',
      redirect: '/dashboard',
    })
  })

  test('drops empty message and redirect', () => {
    expect(buildLoginDeniedSearch({ status: 'user_disabled' })).toEqual({
      status: 'user_disabled',
    })
  })
})
