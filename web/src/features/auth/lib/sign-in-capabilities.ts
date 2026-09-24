// @muw-owned
import type { SystemStatus } from '@/features/auth/types'

import { hasOAuthProviders } from './oauth'

/**
 * 登录页可用能力：登录页与表单都要用它，抽出来避免两处各写一份判断而漂移。
 * 判定口径与既有的 `UserAuthForm` 内联判断保持一致（`status.x ?? status.data.x ?? 默认`）。
 */
/** 登录页主位显示哪种登录方式：OAuth（默认，L1）或账号密码（L3，点次要文字切过去） */
export type SignInMode = 'oauth' | 'password'

export type SignInCapabilities = {
  /** 账号密码登录是否可用（后台开关） */
  passwordLoginEnabled: boolean
  /** 通行密钥（Passkey）登录是否可用 */
  passkeyLoginEnabled: boolean
  /** 是否配置了微信登录 */
  hasWeChatLogin: boolean
  /** 是否配置了任一 OAuth 提供方 */
  hasOAuthLogin: boolean
  /** 是否存在「非密码」的登录方式（OAuth / Passkey / 微信） */
  hasAlternativeLogin: boolean
}

/** 是否配置了任一 OAuth 提供方（GitHub / Discord / OIDC / LinuxDO / Telegram / 自定义） */
export function hasOAuthProvider(
  status: SystemStatus | null | undefined
): boolean {
  return Boolean(
    status?.github_oauth ||
    status?.discord_oauth ||
    status?.oidc_enabled ||
    status?.linuxdo_oauth ||
    status?.telegram_oauth ||
    (status?.custom_oauth_providers?.length ?? 0) > 0
  )
}

/**
 * 是否有任一「第三方」登录方式：OAuth 提供方（GitHub/Discord/OIDC/LinuxDO/Telegram/自定义）
 * 或微信。注册页卡脚那一条入口（「使用第三方登录」）用它判断——账号密码留在注册页，
 * 第三方一律走登录页。
 *
 * 直接复用 `lib/oauth.ts` 的提供方清单（它已含微信），避免同一份清单在两处各写一遍后漂移。
 */
export function hasThirdPartyLogin(
  status: SystemStatus | null | undefined
): boolean {
  return hasOAuthProviders(status ?? null)
}

/**
 * 是否还能走到「注册」页：自用模式关闭 + 注册总开关打开 + 密码注册打开。
 * 与 `/sign-up` 自身的回跳口径一致（`password_register_enabled === false` ⇒ 回登录页），
 * 避免出现「链接点进去又被弹回来」的死链。
 */
export function isPasswordSignUpAvailable(
  status: SystemStatus | null | undefined
): boolean {
  if (!status) return false
  if (status.self_use_mode_enabled) return false
  if (status.register_enabled === false) return false
  if (status.password_register_enabled === false) return false
  return true
}

/**
 * 「注册」CTA 的目标：能走到注册页就给 `/sign-up`，否则给 `/sign-in`（免得主 CTA 点进去又被弹回来）。
 * status 还没到位时先给 `/sign-up` —— 注册页自身会在开关关闭时回跳，不会留死链。
 */
export function getSignUpTarget(
  status: SystemStatus | null | undefined
): '/sign-up' | '/sign-in' {
  if (!status) return '/sign-up'
  return isPasswordSignUpAvailable(status) ? '/sign-up' : '/sign-in'
}

export function getSignInCapabilities(
  status: SystemStatus | null | undefined
): SignInCapabilities {
  const passkeyLoginEnabled = Boolean(
    status?.passkey_login ?? status?.data?.passkey_login
  )
  const passwordLoginEnabled =
    (status?.password_login_enabled ??
      status?.data?.password_login_enabled ??
      true) !== false
  const hasWeChatLogin = Boolean(status?.wechat_login)
  const hasOAuthLogin = hasOAuthProvider(status)

  return {
    passwordLoginEnabled,
    passkeyLoginEnabled,
    hasWeChatLogin,
    hasOAuthLogin,
    hasAlternativeLogin: passkeyLoginEnabled || hasWeChatLogin || hasOAuthLogin,
  }
}
