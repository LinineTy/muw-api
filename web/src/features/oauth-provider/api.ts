// @muw-owned
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type OAuthConsentPreview = {
  client_id: string
  client_name: string
  client_icon_url?: string
  homepage_url?: string
  description: string
  owner_username: string
  redirect_host: string
  scopes: string[]
  remember_silent: boolean
  /** false = 此前已同意、开了「以后不再询问」且这次没有新增 scope，可以免交互放行。 */
  needs_consent: boolean
  /** 客户端要求的 prompt（只认 none：不弹界面，需要交互就回 interaction_required）。 */
  prompt?: string
}

export type OAuthApplication = {
  id: number
  client_id: string
  name: string
  description: string
  client_type: string
  status: string
  scopes: string[]
  redirect_uris: string[]
  review_note: string
  created_at: number
  last_used_at: number
  homepage_url?: string
  icon_url?: string
  owner_username?: string
  apply_reason?: string
  allowed_groups?: string[]
}

export type OAuthConsent = {
  client_id: string
  client_name: string
  scopes: string[]
  silent: boolean
  updated_at: number
}

export type OAuthStats = {
  applications: number
  authorizations: number
  token_issued: number
  last_issued_at: number
  calls: number
  failed_calls: number
  active_users: number
  last_call_at: number
}

/** 统计口径：all 仅管理员（全站）；self = 我创建的应用被怎么用。 */
export type OAuthUsageScope = 'self' | 'all'

export type OAuthUsageTotals = {
  calls: number
  failed_calls: number
  active_users: number
  last_call_at: number
}

export type OAuthUsageApplication = {
  client_id: string
  name: string
  status: string
  calls: number
  failed_calls: number
  active_users: number
  last_call_at: number
}

export type OAuthUsageDaily = { day: string; calls: number; failed: number }
export type OAuthUsageFailure = { error_code: string; count: number }

export type OAuthUsageOverview = {
  applications: OAuthUsageApplication[]
  daily: OAuthUsageDaily[]
  failures: OAuthUsageFailure[]
  totals: OAuthUsageTotals
  days: number
  tz_offset: number
}

export type OAuthApplicationUsageRow = {
  user_id: number
  token_count: number
  last_issued_at: number
}

/**
 * 应用用量：totals 对所有人可见（聚合），items 是逐用户明细，仅管理员会拿到。
 */
export type OAuthApplicationUsage = {
  totals: OAuthUsageTotals
  items: OAuthApplicationUsageRow[]
}

export type OAuthApplicationPayload = {
  name: string
  description: string
  redirect_uris: string[]
  scopes: string[]
  client_type: string
  apply_reason: string
}

export async function getConsentPreview(
  request: string
): Promise<OAuthConsentPreview> {
  const res = await api.get('/api/oauth/consent/preview', {
    params: { request },
  })
  return requireServerSuccess(res.data).data as OAuthConsentPreview
}

export async function submitConsentDecision(payload: {
  request: string
  approve: boolean
  silent: boolean
}): Promise<string> {
  const res = await api.post('/api/oauth/consent/decision', payload)
  return (requireServerSuccess(res.data).data as { redirect_url: string })
    .redirect_url
}

export async function getMyApplications(): Promise<OAuthApplication[]> {
  const res = await api.get('/api/oauth/applications/mine')
  return (requireServerSuccess(res.data).data as { items: OAuthApplication[] })
    .items
}

export async function submitApplication(
  payload: OAuthApplicationPayload
): Promise<void> {
  const res = await api.post('/api/oauth/applications', payload)
  requireServerSuccess(res.data)
}

export async function updateApplication(
  id: number,
  payload: {
    name: string
    description: string
    homepage_url: string
    icon_url: string
    redirect_uris: string[]
  }
): Promise<string> {
  const res = await api.post(`/api/oauth/applications/${id}/update`, payload)
  return (requireServerSuccess(res.data).data as { status: string }).status
}

export async function deleteMyApplication(id: number): Promise<void> {
  const res = await api.delete(`/api/oauth/applications/${id}`)
  requireServerSuccess(res.data)
}

export async function getApplicationUsage(
  id: number
): Promise<OAuthApplicationUsage> {
  const res = await api.get(`/api/oauth/applications/${id}/usage`)
  return requireServerSuccess(res.data).data as OAuthApplicationUsage
}

/**
 * 用量总览：按应用聚合 + 按天趋势 + 失败原因 Top。
 * tz_offset 传浏览器时区偏移（分钟），让"天"按用户看到的日历切。
 */
export async function getOAuthUsage(params: {
  scope: OAuthUsageScope
  days: number
}): Promise<OAuthUsageOverview> {
  const res = await api.get('/api/oauth/usage', {
    params: {
      scope: params.scope,
      days: params.days,
      tz_offset: -new Date().getTimezoneOffset(),
    },
  })
  return requireServerSuccess(res.data).data as OAuthUsageOverview
}

export async function getOAuthStats(
  scope: 'self' | 'all'
): Promise<OAuthStats> {
  const res = await api.get('/api/oauth/stats', { params: { scope } })
  return requireServerSuccess(res.data).data as OAuthStats
}

export async function getMyConsents(): Promise<OAuthConsent[]> {
  const res = await api.get('/api/oauth/consents')
  return (requireServerSuccess(res.data).data as { items: OAuthConsent[] })
    .items
}

export async function setConsentSilent(
  clientId: string,
  silent: boolean
): Promise<void> {
  const res = await api.post('/api/oauth/consents/silent', {
    client_id: clientId,
    silent,
  })
  requireServerSuccess(res.data)
}

export async function revokeConsent(clientId: string): Promise<void> {
  const res = await api.delete(
    `/api/oauth/consents/${encodeURIComponent(clientId)}`
  )
  requireServerSuccess(res.data)
}

export async function revealApplicationSecret(id: number): Promise<string> {
  const res = await api.get(`/api/oauth/applications/${id}/secret`)
  return (requireServerSuccess(res.data).data as { client_secret: string })
    .client_secret
}

export async function rotateApplicationSecret(id: number): Promise<string> {
  const res = await api.post(`/api/oauth/applications/${id}/rotate-secret`)
  return (requireServerSuccess(res.data).data as { client_secret: string })
    .client_secret
}

export async function listApplicationsForReview(params: {
  status: string
  page: number
  pageSize: number
}): Promise<{ items: OAuthApplication[]; total: number }> {
  const res = await api.get('/api/oauth/admin/applications', {
    params: {
      status: params.status,
      page: params.page,
      page_size: params.pageSize,
    },
  })
  const data = requireServerSuccess(res.data).data as {
    items: OAuthApplication[]
    total: number
  }
  return { items: data.items, total: data.total }
}

export async function reviewApplication(
  id: number,
  payload: {
    action: 'approve' | 'reject'
    scopes?: string[]
    redirect_uris?: string[]
    allowed_groups?: string[]
    note?: string
  }
): Promise<{ client_id: string }> {
  const res = await api.post(
    `/api/oauth/admin/applications/${id}/review`,
    payload
  )
  return requireServerSuccess(res.data).data as { client_id: string }
}

export async function updateApplicationStatus(
  id: number,
  action: 'approve' | 'disable',
  note = ''
): Promise<void> {
  const res = await api.post(`/api/oauth/admin/applications/${id}/status`, {
    action,
    note,
  })
  requireServerSuccess(res.data)
}

export async function deleteApplication(id: number): Promise<void> {
  const res = await api.delete(`/api/oauth/admin/applications/${id}`)
  requireServerSuccess(res.data)
}

export type OAuthAccessLog = {
  id: number
  client_id: string
  client_name: string
  user_id: number
  action: string
  grant_type: string
  scopes: string
  ip: string
  user_agent: string
  success: boolean
  error_code: string
  error_message: string
  request_id: string
  created_at: number
}

export type OAuthAccessLogSummary = {
  total_calls: number
  failed_calls: number
  active_clients: number
  active_users: number
}

export type OAuthAccessLogPage = {
  items: OAuthAccessLog[]
  total: number
  page: number
  page_size: number
  summary: OAuthAccessLogSummary
}

// 协议调用明细（含终端用户 IP / UA）：仅管理员。
export async function getOAuthAccessLogs(params: {
  clientId?: string
  action?: string
  success?: string
  page?: number
  pageSize?: number
}): Promise<OAuthAccessLogPage> {
  const query = new URLSearchParams()
  if (params.clientId) query.set('client_id', params.clientId)
  if (params.action) query.set('action', params.action)
  if (params.success) query.set('success', params.success)
  query.set('page', String(params.page ?? 1))
  query.set('page_size', String(params.pageSize ?? 20))
  const res = await api.get(`/api/oauth/access-logs?${query.toString()}`)
  return requireServerSuccess(res.data).data as OAuthAccessLogPage
}
