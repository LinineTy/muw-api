// @muw-owned
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type OAuthConsentPreview = {
  client_id: string
  client_name: string
  description: string
  owner_username: string
  redirect_host: string
  scopes: string[]
  remember_silent: boolean
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
  active_users: number
}

export type OAuthApplicationUsageRow = {
  user_id: number
  token_count: number
  last_issued_at: number
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
): Promise<OAuthApplicationUsageRow[]> {
  const res = await api.get(`/api/oauth/applications/${id}/usage`)
  return (
    requireServerSuccess(res.data).data as { items: OAuthApplicationUsageRow[] }
  ).items
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
