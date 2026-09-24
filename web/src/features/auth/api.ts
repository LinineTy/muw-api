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
import axios from 'axios'

import { api, refreshAuthentication, type RefreshOutcome } from '@/lib/api'
import { AuthOperationError } from '@/lib/secure-verification'
import { getServerErrorMessageKey } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  clearPasswordEncryptionCache,
  encryptPassword,
} from './lib/password-encryption'
import { getPreAuthProof, takePreAuthProof } from './lib/pre-auth-proof'
import { getAffiliateCode } from './lib/storage'
import type { TelegramAuthorization } from './lib/telegram-login'
import type { VerificationOperation } from './secure-verification/types'
import type {
  LoginPayload,
  LoginResponse,
  Login2FAResponse,
  TwoFAPayload,
  RegisterPayload,
  ApiResponse,
} from './types'

// 前置校验凭据拼成查询串（服务端从 query 读，三个入口统一口径）。
function preAuthProofQuery(): string {
  const proof = getPreAuthProof()
  if (!proof) return ''
  const params = new URLSearchParams({
    challenge_id: proof.challengeId,
    nonce: proof.nonce,
  })
  return `&${params.toString()}`
}

// ============================================================================
// Authentication APIs
// ============================================================================

// ----------------------------------------------------------------------------
// Login & Logout
// ----------------------------------------------------------------------------

// User login with username and password
export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const turnstile = payload.turnstile ?? ''
  try {
    let passwordFields:
      | { password: string }
      | { password_encrypted: string; encryption_key_id: string }
    if (payload.passwordEncryptionEnabled) {
      const encryptedPassword = await encryptPassword(payload.password)
      passwordFields = {
        password_encrypted: encryptedPassword.password_encrypted,
        encryption_key_id: encryptedPassword.encryption_key_id,
      }
    } else {
      passwordFields = { password: payload.password }
    }
    const res = await api.post<LoginResponse>(
      `/api/user/login?turnstile=${turnstile}${preAuthProofQuery()}`,
      {
        username: payload.username,
        ...passwordFields,
      },
      { skipAuthRefresh: true }
    )
    if (payload.passwordEncryptionEnabled && !res.data?.success) {
      clearPasswordEncryptionCache()
    }
    // 服务端在门禁通过时就消费掉挑战，客户端跟着作废，下一拍要重新算
    takePreAuthProof()
    return res.data
  } catch (error: unknown) {
    if (payload.passwordEncryptionEnabled) {
      clearPasswordEncryptionCache()
    }
    throw error
  }
}

// Two-factor authentication login
export async function login2fa(payload: TwoFAPayload) {
  const res = await api.post<Login2FAResponse>('/api/user/login/2fa', payload, {
    skipAuthRefresh: true,
    skipBusinessError: true,
  })
  return res.data
}

interface LogoutRuntime {
  getExpectedSID: () => string | undefined
  request: (expectedSID?: string) => Promise<ApiResponse>
  refresh: () => Promise<RefreshOutcome>
}

export async function executeLogout(
  runtime: LogoutRuntime,
  allowMismatchRecovery = true
): Promise<ApiResponse> {
  try {
    return await runtime.request(runtime.getExpectedSID())
  } catch (error: unknown) {
    const code = axios.isAxiosError(error)
      ? error.response?.data?.code
      : undefined
    if (
      allowMismatchRecovery &&
      axios.isAxiosError(error) &&
      error.response?.status === 409 &&
      code === 'AUTH_SESSION_MISMATCH'
    ) {
      const outcome = await runtime.refresh()
      if (outcome.kind === 'authenticated') {
        return executeLogout(runtime, false)
      }
      if (outcome.kind === 'anonymous') {
        return { success: true, message: '' }
      }
    }
    throw error
  }
}

// User logout
export async function logout(): Promise<ApiResponse> {
  return executeLogout({
    getExpectedSID: () => useAuthStore.getState().auth.session?.sid,
    request: async (sid) => {
      const res = await api.post('/api/user/auth/logout', undefined, {
        headers: sid ? { 'X-Auth-Session': sid } : undefined,
        skipAuthRefresh: true,
        skipErrorHandler: true,
      })
      return res.data
    },
    refresh: refreshAuthentication,
  })
}

// ----------------------------------------------------------------------------
// Password Management
// ----------------------------------------------------------------------------

// Send password reset email
export async function sendPasswordResetEmail(
  email: string,
  turnstile?: string
): Promise<ApiResponse> {
  const res = await api.get('/api/reset_password', {
    params: { email, turnstile },
  })
  return res.data
}

// ----------------------------------------------------------------------------
// OAuth
// ----------------------------------------------------------------------------

// Start GitHub OAuth flow
export async function githubOAuthStart(clientId: string, state: string) {
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}&scope=user:email`
  window.open(url)
}

// Get OAuth state for CSRF protection
export async function createOAuthAuthorization(
  provider: string,
  intent: 'login' | 'bind' | 'verify' | 'refresh',
  operation?: VerificationOperation,
  signal?: AbortSignal,
  proofToken?: string
): Promise<{ state: string; authorizationUrl?: string }> {
  const aff = intent === 'login' ? getAffiliateCode() : ''
  const res = await api.post(
    // 第三方登录同样要过前置校验：服务端在签发 state 这一步校验，回调侧必须消费服务端签发的
    // state，所以绕过前端直接构造回调也会被挡下。
    `/api/oauth/state${intent === 'login' ? preAuthProofQuery() : ''}`,
    {
      provider,
      intent,
      aff: aff || undefined,
      scope: operation?.scope,
      ...(operation?.context ? { context: operation.context } : {}),
    },
    {
      skipAuthRefresh: intent === 'login',
      ...(proofToken ? { headers: { 'X-Security-Proof': proofToken } } : {}),
      singleUseAuthorization: intent === 'bind',
      signal,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  if (intent === 'login') {
    // 同登录/注册：state 签发成功即代表挑战已被服务端消费
    takePreAuthProof()
  }
  if (res.data?.success) {
    if (typeof res.data.data === 'string') return { state: res.data.data }
    if (typeof res.data.data?.flow_token === 'string') {
      return {
        state: res.data.data.flow_token,
        authorizationUrl: res.data.data.authorization_url,
      }
    }
  }
  throw new AuthOperationError(
    getServerErrorMessageKey(res.data) ||
      res.data?.message ||
      'Failed to initialize OAuth',
    res.data?.code
  )
}

export async function createOAuthFlow(
  provider: string,
  intent: 'login' | 'bind' | 'verify' | 'refresh',
  operation?: VerificationOperation,
  signal?: AbortSignal
): Promise<string> {
  return (await createOAuthAuthorization(provider, intent, operation, signal))
    .state
}

// WeChat login by authorization code
// 微信登录/首登建号同属第一因素，服务端同样要前置校验凭据（凭据走查询串）。
export async function wechatLoginByCode(code: string): Promise<ApiResponse> {
  const proof = getPreAuthProof()
  const res = await api.get('/api/oauth/wechat', {
    params: {
      code,
      challenge_id: proof?.challengeId,
      nonce: proof?.nonce,
    },
    skipBusinessError: true,
  })
  takePreAuthProof()
  return res.data
}

export async function telegramLogin(
  authorization: TelegramAuthorization
): Promise<ApiResponse> {
  const res = await api.get('/api/oauth/telegram/login', {
    params: authorization,
    disableDuplicate: true,
    skipAuthRefresh: true,
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  return res.data
}

// ----------------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------------

// User registration
export async function register(payload: RegisterPayload): Promise<ApiResponse> {
  const res = await api.post(`/api/user/register`, payload, {
    params: {
      turnstile: payload.turnstile ?? '',
      challenge_id: getPreAuthProof()?.challengeId,
      nonce: getPreAuthProof()?.nonce,
    },
    skipBusinessError: true,
  })
  takePreAuthProof()
  return res.data
}

// 激活制：待激活账号提交邀请码转正，返回更新后的用户对象。
// 除邀请码外还带两类字段：
//   - challenge_id/nonce：人机校验（PoW）凭据，服务端开启校验时必填；
//   - website：隐形蜜罐字段，真人永远为空（服务端据此直接处置自动化提交）。
// 失败响应可能带机器码 `code`（ACTIVATION_VERIFICATION_REQUIRED/FAILED），调用方据此重算。
export type ActivateAccountPayload = {
  inviteCode: string
  challengeId?: string
  nonce?: string
  website?: string
}

export async function activateAccount(
  payload: ActivateAccountPayload
): Promise<ApiResponse> {
  const res = await api.post('/api/user/activate', {
    invite_code: payload.inviteCode,
    challenge_id: payload.challengeId,
    nonce: payload.nonce,
    website: payload.website,
  })
  return res.data
}

// 登录/注册/第三方登录入口的前置人机校验挑战（匿名可领，按 IP 计数，一次性 5 分钟）。
// 与激活页挑战不通用（服务端按 purpose 判定）；enabled=false 表示本站没开校验，直接跳过。
// 取挑战失败必须抛出去：把"取不到"当成"没开校验"会让客户端静默放行，用户提交后才被
// 服务端挡下、却看不到原因（见 use-security-check.ts 的失败提示）。
export async function getLoginChallenge(): Promise<ActivationChallenge> {
  const res = await api.post('/api/user/login_challenge', undefined, {
    skipAuthRefresh: true,
    skipBusinessError: true,
  })
  const body = res?.data
  if (body?.success && body.data) {
    return body.data as ActivationChallenge
  }
  throw new Error(body?.message || 'login challenge unavailable')
}

// 激活页人机校验：提交前先领一道一次性挑战（5 分钟有效）。enabled=false 表示本站未开启校验，
// 前端跳过即可；取不到挑战时调用方应提示"稍后重试"，不要用不带校验的提交去碰壁。
export type ActivationChallenge = {
  enabled: boolean
  challenge_id?: string
  challenge?: string
  bits?: number
  expires_in?: number
}

export async function getActivationChallenge(): Promise<ActivationChallenge> {
  const res = await api.post('/api/user/activation_challenge', undefined, {
    skipBusinessError: true,
  })
  const body = res?.data
  if (body?.success && body.data) {
    return body.data as ActivationChallenge
  }
  throw new Error(body?.message || 'activation challenge unavailable')
}

// 激活页倒计时：本人若有未结的钓鱼码宽限（宽限期内提交有效邀请码即可免于停用），
// 返回截止时间与剩余秒数；没有则 pending=false。读不到不报错，交给调用方兜底。
export type ActivationDeadline = {
  pending: boolean
  expire_at?: number
  remaining_seconds?: number
}

export async function getActivationDeadline(): Promise<ActivationDeadline> {
  const res = await api.get('/api/user/activation_deadline')
  const body = res?.data
  if (body?.success && body.data) {
    return body.data as ActivationDeadline
  }
  return { pending: false }
}

// Send email verification code
export async function sendEmailVerification(
  email: string,
  turnstile?: string
): Promise<ApiResponse> {
  const res = await api.get('/api/verification', {
    params: { email, turnstile },
  })
  return res.data
}

// Confirm an authenticated, server-owned email binding flow.
export async function bindEmail(
  flowToken: string,
  newCode: string,
  oldCode = '',
  signal?: AbortSignal
): Promise<ApiResponse> {
  const res = await api.post(
    '/api/oauth/email/bind',
    {
      flow_token: flowToken,
      new_code: newCode,
      old_code: oldCode,
    },
    { singleUseAuthorization: true, signal }
  )
  return res.data
}
