// @muw-owned
import { describe, expect, it } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'

import { getSignInCapabilities } from './sign-in-capabilities'

const asStatus = (value: Partial<SystemStatus>) => value as SystemStatus

describe('getSignInCapabilities', () => {
  it('默认允许密码登录，且没有替代登录方式', () => {
    const caps = getSignInCapabilities(asStatus({}))
    expect(caps.passwordLoginEnabled).toBe(true)
    expect(caps.hasAlternativeLogin).toBe(false)
  })

  it('LinuxDO OAuth 属于替代登录方式', () => {
    const caps = getSignInCapabilities(asStatus({ linuxdo_oauth: true }))
    expect(caps.hasOAuthLogin).toBe(true)
    expect(caps.hasAlternativeLogin).toBe(true)
  })

  it('密码登录开关为 false 时只保留替代方式', () => {
    const caps = getSignInCapabilities(
      asStatus({ password_login_enabled: false, linuxdo_oauth: true })
    )
    expect(caps.passwordLoginEnabled).toBe(false)
    expect(caps.hasAlternativeLogin).toBe(true)
  })

  it('通行密钥 / 微信同样算替代登录方式', () => {
    expect(
      getSignInCapabilities(asStatus({ passkey_login: true }))
        .hasAlternativeLogin
    ).toBe(true)
    expect(
      getSignInCapabilities(asStatus({ wechat_login: true }))
        .hasAlternativeLogin
    ).toBe(true)
  })
})
