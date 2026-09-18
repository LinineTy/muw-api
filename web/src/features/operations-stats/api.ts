// @muw-owned
import { api } from '@/lib/http-client'

import type {
  OperationsDistributions,
  OperationsOverview,
  OperationsRankings,
  OperationsTrendRow,
} from './types'

export async function getOperationsOverview(): Promise<{
  success: boolean
  message?: string
  data?: OperationsOverview
}> {
  const res = await api.get('/api/operations_stats/overview')
  return res.data
}

export async function getOperationsTrends(
  days: number
): Promise<{ success: boolean; message?: string; data?: OperationsTrendRow[] }> {
  const res = await api.get('/api/operations_stats/trends', {
    params: {
      days,
      // 后端约定：负数视为分钟（getTimezoneOffset），正数为秒偏移。
      tz_offset: -new Date().getTimezoneOffset() * 60,
    },
  })
  return res.data
}

export async function getOperationsDistributions(): Promise<{
  success: boolean
  message?: string
  data?: OperationsDistributions
}> {
  const res = await api.get('/api/operations_stats/distributions')
  return res.data
}

export async function getOperationsRankings(
  days: number
): Promise<{ success: boolean; message?: string; data?: OperationsRankings }> {
  const res = await api.get('/api/operations_stats/rankings', {
    params: { days },
  })
  return res.data
}
