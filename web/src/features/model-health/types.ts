// @muw-owned
export type TestTrendPoint = {
  created_at: number
  response_time: number
  success: boolean
  /** 失败归类: client=请求自身问题(黄) / moderation=内容审核拦截(绿) / upstream=上游问题(红); 空=旧数据(按红渲染) */
  error_kind?: string
}

export type ModelHealthRow = {
  channel_id: number
  channel_name: string
  model_name: string
  test_count: number
  success_count: number
  success_rate: number
  avg_response_time: number
  last_response_time: number
  last_test_time: number
  last_error: string
  /** 最近一次展示错误的归类,配合详情圆点分色 */
  last_error_kind?: string
  trend: TestTrendPoint[]
  user_traffic_count?: number
  client_error_count?: number
  upstream_error_count?: number
  moderation_count?: number
}

export type ChannelTestRecord = {
  id: number
  channel_id: number
  channel_name: string
  model_name: string
  success: boolean
  response_time: number
  error_reason: string
  error_kind?: string
  source?: string
  created_at: number
}

export type ModelHealthParams = {
  days?: number
  channel_id?: number
  q?: string
  unhealthy?: boolean
}

export type ChannelTestRecordsParams = {
  channel_id: number
  model?: string
  page?: number
  page_size?: number
}

export type ChannelTestRecordsResult = {
  records: ChannelTestRecord[]
  total: number
}
