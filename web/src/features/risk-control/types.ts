export interface PageInfo<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface CreditScoreLog {
  id: number
  user_id: number
  source: string
  points: number
  balance: number
  request_id: string
  reason: string
  created_at: number
}

export interface ConversationRecord {
  id: number
  user_id: number
  token_id: number
  channel_id: number
  request_id: string
  model_name: string
  relay_mode: number
  is_stream: boolean
  status_code: number
  // 列表接口按性能考虑不做正文投影，正文走详情接口按 id 拉取。
  request?: string
  response?: string
  created_at: number
}

export interface MarkerSuggestion {
  id: number
  marker: string
  example: string
  reason: string
  /** 来源错误日志 id 集合（JSON 数组文本，如 "[55813,55842]"；空串=未关联）。 */
  log_ids?: string
  source: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: number
}

export interface MarkerAnalysisLog {
  id: number
  triggered_by: 'manual' | 'threshold' | 'force'
  started_at: number
  finished_at: number
  duration_ms: number
  analyzed_count: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  model: string
  base_url: string
  suggestions_count: number
  /** 本次运行因 429/5xx 自动重试的次数（0=未遇限流）。 */
  retried: number
  /** 本次运行用的提示词标识：默认提示词为 "default"，自定义提示词为其单行预览。 */
  prompt_used?: string
  error_message: string
  created_at: number
}
