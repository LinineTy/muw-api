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
  source: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: number
}

export interface MarkerAnalysisLog {
  id: number
  triggered_by: 'manual' | 'scheduled'
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
  error_message: string
  created_at: number
}

export interface MarkerSuggestionSummary {
  analyzed: number
  suggestions: number
}
