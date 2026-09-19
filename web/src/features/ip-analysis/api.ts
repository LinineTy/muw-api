// @muw-owned
import { api } from '@/lib/http-client'

import type {
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
}): Promise<{
  success: boolean
  message?: string
  data?: UserIpDetailRow[]
}> {
  const res = await api.get(
    `/api/ip_analysis/user/${params.user_id}`,
    { params: { days: params.days, ip_version: params.ip_version } }
  )
  return res.data
}

export async function getIpUserDetail(params: {
  ip: string
  days: number
}): Promise<{
  success: boolean
  message?: string
  data?: IpUserDetailRow[]
}> {
  const res = await api.get('/api/ip_analysis/ip', { params })
  return res.data
}
