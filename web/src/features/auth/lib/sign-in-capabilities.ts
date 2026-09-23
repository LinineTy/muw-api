// @muw-owned
import type { SystemStatus } from '@/features/auth/types'

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
  const hasOAuthLogin = Boolean(
    status?.github_oauth ||
    status?.discord_oauth ||
    status?.oidc_enabled ||
    status?.linuxdo_oauth ||
    status?.telegram_oauth ||
    (status?.custom_oauth_providers?.length ?? 0) > 0
  )

  return {
    passwordLoginEnabled,
    passkeyLoginEnabled,
    hasWeChatLogin,
    hasOAuthLogin,
    hasAlternativeLogin: passkeyLoginEnabled || hasWeChatLogin || hasOAuthLogin,
  }
}
