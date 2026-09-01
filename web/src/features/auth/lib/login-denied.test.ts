// @muw-owned
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
