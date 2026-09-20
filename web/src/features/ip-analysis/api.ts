// @muw-owned
import { api } from '@/lib/http-client'

import type {
  IpAnalysisOverview,
  IpAnalysisTrendRow,
  IpOverlapRow,
  IpRankRow,
  IpUserDetailRow,
  IpUserRankRow,
  Paged,
  UserIpDetailRow,
} from './types'

export async function getIpUserRank(params: {
  days: number
  min_ips: number
  ip_version: string
  merge_v6: number
  page: number
  page_size: number
}): Promise<{ success: boolean; message?: string; data?: Paged<IpUserRankRow> }> {
  const res = await api.get('/api/ip_analysis/rank/users', { params })
  return res.data
}

export async function getIpRank(params: {
  days: number
  min_users: number
  ip_version: string
  merge_v6: number
  page: number
  page_size: number
}): Promise<{ success: boolean; message?: string; data?: Paged<IpRankRow> }> {
  const res = await api.get('/api/ip_analysis/rank/ips', { params })
  return res.data
}

export async function getUserIpDetail(params: {
  user_id: number
  days: number
  ip_version: string
  merge_v6: number
}): Promise<{
  success: boolean
  message?: string
  data?: UserIpDetailRow[]
}> {
  const res = await api.get(
    `/api/ip_analysis/user/${params.user_id}`,
    {
      params: {
        days: params.days,
        ip_version: params.ip_version,
        merge_v6: params.merge_v6,
      },
    }
  )
  return res.data
}

export async function getIpUserDetail(params: {
  ip: string
  days: number
  merge_v6: number
}): Promise<{
  success: boolean
  message?: string
  data?: IpUserDetailRow[]
}> {
  const res = await api.get('/api/ip_analysis/ip', { params })
  return res.data
}

export async function getIpOverview(params: {
  days: number
  ip_version: string
  merge_v6: number
}): Promise<{
  success: boolean
  message?: string
  data?: IpAnalysisOverview
}> {
  const res = await api.get('/api/ip_analysis/overview', { params })
  return res.data
}

export async function getIpTrend(params: {
  days: number
  ip_version: string
  tz_offset: number
  merge_v6: number
}): Promise<{
  success: boolean
  message?: string
  data?: IpAnalysisTrendRow[]
}> {
  const res = await api.get('/api/ip_analysis/trend', { params })
  return res.data
}

export async function getIpOverlap(params: {
  days: number
  min_active_minutes: number
  min_overlap: number
  limit: number
}): Promise<{
  success: boolean
  message?: string
  data?: IpOverlapRow[]
}> {
  const res = await api.get('/api/ip_analysis/overlap', { params })
  return res.data
}
