// @muw-owned
/**
 * 解析后端登录/建号被拒响应中的结构化 login_status。
 *
 * 后端通过 common.ApiErrorLoginDenied 返回：
 *   { success:false, code:"AUTH_LOGIN_DENIED", message, data:{ login_status:{ status, reason } } }
 * 前端据此跳转中间态页展示原因，而非一闪而过的 toast。
 * 同时兼容 axios 错误形态（error.response.data），与 server-error-message.ts 一致。
 */

export interface LoginDeniedInfo {
  status: string
  reason?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function loginStatusPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null

  const response = value.response
  if (isRecord(response) && isRecord(response.data)) {
    return response.data
  }
  return value
}

export function getLoginDeniedInfo(value: unknown): LoginDeniedInfo | null {
  const payload = loginStatusPayload(value)
  if (!payload) return null

  const data = payload.data
  if (!isRecord(data)) return null

  const loginStatus = data.login_status
  if (!isRecord(loginStatus)) return null

  const status = loginStatus.status
  if (typeof status !== 'string' || status.length === 0) return null

  const info: LoginDeniedInfo = { status }
  if (typeof loginStatus.reason === 'string' && loginStatus.reason.length > 0) {
    info.reason = loginStatus.reason
  }
  return info
}

export interface LoginResultSearchParams {
  status?: string
  reason?: string
  message?: string
  redirect?: string
}

/**
 * 由 login_status + 后端 message 构造中间态页的 query 参数。
 * redirect 调用方需先经 sanitizeAuthRedirect 净化（中间态页会再兜底一次）。
 */
export function buildLoginDeniedSearch(
  denied: LoginDeniedInfo,
  message?: unknown,
  redirect?: string
): LoginResultSearchParams {
  const search: LoginResultSearchParams = { status: denied.status }
  if (denied.reason) search.reason = denied.reason
  if (typeof message === 'string' && message.length > 0)
    search.message = message
  if (redirect) search.redirect = redirect
  return search
}
