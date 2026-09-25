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
