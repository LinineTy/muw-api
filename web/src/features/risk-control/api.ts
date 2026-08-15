import type { User } from '@/features/users/types'
import { api } from '@/lib/api'

import type {
  CreditScoreLog,
  ConversationRecord,
  MarkerSuggestion,
  MarkerSuggestionSummary,
  PageInfo,
} from './types'

// api 拦截器不自动解包 {success, message, data}：统一解包到 data 并抛错。
async function unwrapData<T>(promise: Promise<unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = promise as Promise<{
    data?: { success?: boolean; message?: string; data?: T }
  }>
  const body = await res
  if (!body?.data?.success) {
    throw new Error(body?.data?.message || 'Request failed')
  }
  return body.data.data as T
}

export interface RiskControlOverview {
  low_score_users: number
  freeze_threshold: number
  freeze_enabled: boolean
  today_deductions: number
  today_violation_events: number
  today_conversations: number
  total_credit_logs: number
  conversations_used_bytes: number
  conversations_cap_bytes: number
}

export async function getRiskControlOverview(): Promise<RiskControlOverview> {
  return unwrapData(api.get('/api/risk-control/overview'))
}

export async function getLowScoreUsers(params: {
  p?: number
  page_size?: number
  threshold?: number
}): Promise<PageInfo<User>> {
  return unwrapData(api.get('/api/risk-control/users', { params }))
}

export async function getCreditScoreLogs(params: {
  p?: number
  page_size?: number
  user_id?: number
  source?: string
}): Promise<PageInfo<CreditScoreLog>> {
  return unwrapData(api.get('/api/risk-control/logs', { params }))
}

export async function adjustCreditScore(payload: {
  user_id: number
  points: number
  reason?: string
}): Promise<{ user_id: number; balance: number }> {
  return unwrapData(api.post('/api/risk-control/adjust', payload))
}

export async function getConversationRecords(params: {
  p?: number
  page_size?: number
  user_id?: number
  token_id?: number
  request_id?: string
  model_name?: string
}): Promise<PageInfo<ConversationRecord>> {
  return unwrapData(api.get('/api/conversation-records/', { params }))
}

export async function getConversationRecord(
  id: number
): Promise<ConversationRecord> {
  return unwrapData(api.get(`/api/conversation-records/${id}`))
}

export async function getMarkers(): Promise<{ markers: string[] }> {
  return unwrapData(api.get('/api/risk-control/markers'))
}

export async function updateMarkers(
  markers: string[]
): Promise<{ markers: string[] }> {
  return unwrapData(api.put('/api/risk-control/markers', { markers }))
}

export async function getMarkerSuggestions(params: {
  p?: number
  page_size?: number
  status?: string
}): Promise<PageInfo<MarkerSuggestion>> {
  return unwrapData(api.get('/api/risk-control/marker-suggestions', { params }))
}

export async function analyzeMarkers(): Promise<MarkerSuggestionSummary> {
  return unwrapData(api.post('/api/risk-control/analyze-markers'))
}

export async function acceptMarkerSuggestion(
  id: number
): Promise<{ id: number }> {
  return unwrapData(
    api.post(`/api/risk-control/marker-suggestions/${id}/accept`)
  )
}

export async function rejectMarkerSuggestion(
  id: number
): Promise<{ id: number }> {
  return unwrapData(
    api.post(`/api/risk-control/marker-suggestions/${id}/reject`)
  )
}
