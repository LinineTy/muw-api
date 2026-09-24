// @muw-owned
import { describe, expect, it } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'

import {
  getSignInCapabilities,
  hasOAuthProvider,
  isPasswordSignUpAvailable,
} from './sign-in-capabilities'

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

describe('hasOAuthProvider', () => {
  it('没有任何提供方时为 false（注册页的 OAuth 出口要隐藏）', () => {
    expect(hasOAuthProvider(asStatus({}))).toBe(false)
    expect(hasOAuthProvider(null)).toBe(false)
  })

  it('任意一个提供方开着就为 true，且不限于 LinuxDO', () => {
    expect(hasOAuthProvider(asStatus({ linuxdo_oauth: true }))).toBe(true)
    expect(hasOAuthProvider(asStatus({ github_oauth: true }))).toBe(true)
    expect(hasOAuthProvider(asStatus({ telegram_oauth: true }))).toBe(true)
    expect(
      hasOAuthProvider(
        asStatus({ custom_oauth_providers: [{ id: 1 } as never] })
      )
    ).toBe(true)
  })
})

describe('isPasswordSignUpAvailable', () => {
  it('三项都开才为 true', () => {
    expect(
      isPasswordSignUpAvailable(
        asStatus({
          register_enabled: true,
          password_register_enabled: true,
          self_use_mode_enabled: false,
        })
      )
    ).toBe(true)
  })

  it('密码注册关 / 注册总开关关 / 自用模式 任一命中即为 false', () => {
    expect(
      isPasswordSignUpAvailable(
        asStatus({ register_enabled: true, password_register_enabled: false })
      )
    ).toBe(false)
    expect(
      isPasswordSignUpAvailable(
        asStatus({ register_enabled: false, password_register_enabled: true })
      )
    ).toBe(false)
    expect(
      isPasswordSignUpAvailable(
        asStatus({ self_use_mode_enabled: true, password_register_enabled: true })
      )
    ).toBe(false)
  })

  it('状态还没拉到时按"不给注册入口"处理', () => {
    expect(isPasswordSignUpAvailable(null)).toBe(false)
    expect(isPasswordSignUpAvailable(undefined)).toBe(false)
  })
})
