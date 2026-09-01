// @muw-owned
import { api } from '@/lib/http-client'

import type {
  ChannelTestRecordsParams,
  ChannelTestRecordsResult,
  ModelHealthParams,
  ModelHealthRow,
} from './types'

export async function getModelHealth(
  params: ModelHealthParams
): Promise<{ success: boolean; message?: string; data?: ModelHealthRow[] }> {
  const res = await api.get('/api/channel/health/models', { params })
  return res.data
}

export async function getChannelTestRecords(
  params: ChannelTestRecordsParams
): Promise<{
  success: boolean
  message?: string
  data?: ChannelTestRecordsResult
}> {
  const res = await api.get('/api/channel/health/records', { params })
  return res.data
}
