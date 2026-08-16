import type { User } from '@/features/users/types'
import { api } from '@/lib/api'

import type {
  CreditScoreLog,
  ConversationRecord,
  MarkerAnalysisLog,
  MarkerSuggestion,
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

export interface CreditScoreSegment {
  segment: string
  count: number
}

export interface RiskControlOverview {
  low_score_users: number
  freeze_threshold: number
  full_score?: number
  freeze_enabled: boolean
  today_deductions: number
  today_violation_events: number
  today_conversations: number
  total_credit_logs: number
  conversations_used_bytes: number
  conversations_cap_bytes: number
  /** 信用分按满分百分比分桶的用户数分布（区间等比缩放，改数值不影响展示）。 */
  credit_score_distribution?: CreditScoreSegment[]
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

/** 重置违规标记词为系统初始自带的默认值。 */
export async function resetMarkers(): Promise<{ markers: string[] }> {
  return unwrapData(api.post('/api/risk-control/markers/reset'))
}

/** 重置标记词分析提示词为系统内置默认值，返回默认提示词供表单回填。 */
export async function resetMarkerAnalysisPrompt(): Promise<{ prompt: string }> {
  return unwrapData(api.post('/api/risk-control/marker-analysis/reset-prompt'))
}

export async function getMarkerSuggestions(params: {
  p?: number
  page_size?: number
  status?: string
}): Promise<PageInfo<MarkerSuggestion>> {
  return unwrapData(api.get('/api/risk-control/marker-suggestions', { params }))
}

export async function getMarkerAnalysisLogs(params: {
  p?: number
  page_size?: number
}): Promise<PageInfo<MarkerAnalysisLog>> {
  return unwrapData(
    api.get('/api/risk-control/marker-analysis-logs', { params })
  )
}

export interface MarkerAnalysisErrorStats {
  total_error_logs: number
  unanalyzed_error_logs: number
  analyzed_error_logs: number
  threshold_enabled: boolean
  threshold_count: number
  /** 已处理到的错误日志最大 id（水位线）；其后的错误都算"未分析"。 */
  watermark: number
}

/** 错误积压统计（累计：未分析 = 水位线之后新增，无 24h 窗口）+ 定量触发配置。 */
export async function getMarkerAnalysisErrorStats(): Promise<MarkerAnalysisErrorStats> {
  return unwrapData(api.get('/api/risk-control/marker-analysis-error-stats'))
}

export interface AnalyzeMarkersResult {
  started: boolean
  task_id: string
}

/** 触发一次标记词分析（后台任务，轮询 status 看进度）。force=true 从建站第一条强制全跑。 */
export async function analyzeMarkers(
  opts: { force?: boolean } = {}
): Promise<AnalyzeMarkersResult> {
  return unwrapData(
    api.post('/api/risk-control/analyze-markers', {
      force: opts.force ?? false,
    })
  )
}

export interface MarkerAnalysisStatus {
  running: boolean
  state?: {
    total: number
    processed: number
    suggestions: number
    progress: number
  }
  last?: {
    analyzed: number
    suggestions: number
    error: string
    finished_at: number
  }
}

/** 标记词分析任务状态：是否在跑（含进度）、最近一次结果/错误。 */
export async function getMarkerAnalysisStatus(): Promise<MarkerAnalysisStatus> {
  return unwrapData(api.get('/api/risk-control/marker-analysis/status'))
}

export interface CreditScoreResetStatus {
  running: boolean
  state?: {
    total: number
    processed: number
    progress: number
  }
  last?: {
    reset: number
    skipped: number
    failed: number
    cleared_logs: number
    error: string
    finished_at: number
  }
}

/** 触发全站信誉分重置（后台任务，所有用户 credit_score 归一到当前满分 + 清保证书冷却）。 */
export async function resetCreditScores(): Promise<{
  started: boolean
  task_id: string
}> {
  return unwrapData(api.post('/api/risk-control/reset-credit-scores'))
}

/** 信誉分重置任务状态：是否在跑（含进度）、最近一次结果/错误。 */
export async function getCreditScoreResetStatus(): Promise<CreditScoreResetStatus> {
  return unwrapData(api.get('/api/risk-control/credit-score-reset/status'))
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

export interface MarkerAnalysisTokenStatus {
  configured: boolean
  masked_key: string
  group: string
  /** token 表里的实际分组（设置页单独保存 group 后与 option 不一致，用于红字提醒重新生成）。 */
  token_group: string
  internal_base_url: string
}

export async function getMarkerAnalysisTokenStatus(): Promise<MarkerAnalysisTokenStatus> {
  return unwrapData(api.get('/api/risk-control/marker-analysis-token-status'))
}

export async function regenerateMarkerAnalysisToken(
  group: string
): Promise<MarkerAnalysisTokenStatus> {
  return unwrapData(
    api.post('/api/risk-control/regenerate-analysis-token', { group })
  )
}

/** 全部可用分组名（管理员视角，设置页分组下拉用）。 */
export async function getAllGroups(): Promise<string[]> {
  return unwrapData(api.get('/api/group/'))
}

/** 拉取自定义端点（上游 /v1/models）的模型列表（custom 模式"自动获取"分析模型用）。 */
export async function fetchUpstreamModels(payload: {
  base_url: string
  api_key: string
}): Promise<{ models: string[] }> {
  return unwrapData(
    api.post('/api/risk-control/fetch-upstream-models', payload)
  )
}
