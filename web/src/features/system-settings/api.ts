/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/api'

import type {
  FetchUpstreamRatiosRequest,
  LogCleanupTask,
  SystemOptionsResponse,
  SystemTaskListResponse,
  SystemTaskResponse,
  UpdateOptionRequest,
  UpdateOptionResponse,
  UpstreamChannelsResponse,
  UpstreamRatiosResponse,
} from './types'

export async function getSystemOptions() {
  const res = await api.get<SystemOptionsResponse>('/api/option/')
  return res.data
}

export async function updateSystemOption(request: UpdateOptionRequest) {
  const res = await api.put<UpdateOptionResponse>('/api/option/', request)
  return res.data
}

export async function startLogCleanupTask(targetTimestamp: number) {
  const res = await api.post<SystemTaskResponse<LogCleanupTask>>(
    '/api/system-task/log-cleanup',
    null,
    {
      params: { target_timestamp: targetTimestamp },
    }
  )
  return res.data
}

export async function getCurrentLogCleanupTask() {
  const res = await api.get<SystemTaskResponse<LogCleanupTask | null>>(
    '/api/system-task/current',
    {
      params: { type: 'log_cleanup' },
    }
  )
  return res.data
}

export async function getSystemTask(taskId: string) {
  const res = await api.get<SystemTaskResponse<LogCleanupTask>>(
    `/api/system-task/${taskId}`
  )
  return res.data
}

export async function listSystemTasks(limit = 20) {
  const res = await api.get<SystemTaskListResponse>('/api/system-task/list', {
    params: { limit },
  })
  return res.data
}

export async function resetModelRatios() {
  const res = await api.post<UpdateOptionResponse>(
    '/api/option/rest_model_ratio'
  )
  return res.data
}

export async function getUpstreamChannels() {
  const res = await api.get<UpstreamChannelsResponse>(
    '/api/ratio_sync/channels'
  )
  return res.data
}

export async function getSystemGroups(): Promise<string[]> {
  const res = await api.get<{
    success: boolean
    message?: string
    data: string[]
  }>('/api/group/')
  return res.data.data ?? []
}

// SystemOptionModel 只取设置下拉需要的字段（模型名 + 启用状态），避免耦合
// 管理端完整的 Model 类型。
type SystemOptionModel = {
  model_name: string
  status: number
}

// 后端 GetPageQuery 将 page_size 截断为 100，模型数量可能超过一页，
// 因此循环拉取所有页直到拿满 total。
export async function getAllSystemModels(): Promise<SystemOptionModel[]> {
  const pageSize = 100
  const all: SystemOptionModel[] = []
  for (let page = 1; ; page++) {
    const res = await api.get<{
      success: boolean
      message?: string
      data?: { items: SystemOptionModel[]; total: number }
    }>('/api/models/', { params: { p: page, page_size: pageSize } })
    const items = res.data.data?.items ?? []
    const total = res.data.data?.total ?? 0
    all.push(...items)
    if (items.length === 0 || all.length >= total) break
    // 兜底：避免异常时无限循环
    if (page >= 1000) break
  }
  return all
}

export async function fetchUpstreamRatios(request: FetchUpstreamRatiosRequest) {
  const res = await api.post<UpstreamRatiosResponse>(
    '/api/ratio_sync/fetch',
    request
  )
  return res.data
}

/** 全部用户分组名(订阅组优先级选择器数据源,与套餐表单 UpgradeGroup 同源) */
export async function getGroupOptions(): Promise<string[]> {
  const res = await api.get<{ data?: string[]; success?: boolean }>(
    '/api/group'
  )
  return res.data?.data ?? []
}
