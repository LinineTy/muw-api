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

import { API_ENDPOINTS } from './constants'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ModelOption,
  GroupOption,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Upload an image to the user's private playground storage.
 * permanent=true saves it to the user's permanent collection (never GC'd).
 */
export async function uploadPlaygroundImage(
  file: File,
  permanent = false
): Promise<{ id: number; url: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const query = permanent ? '?permanent=true' : ''
  const res = await api.post(
    `${API_ENDPOINTS.PLAYGROUND_IMAGE_UPLOAD}${query}`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      skipErrorHandler: true,
    }
  )
  return res.data.data
}

/**
 * List the current user's playground images; permanent=true (default) filters
 * to the permanent collection used by the "my images" gallery.
 */
export async function listPlaygroundImages(permanent = true): Promise<
  Array<{
    id: number
    name: string
    ext: string
    url: string
    size: number
    permanent: boolean
    created_time: number
  }>
> {
  const res = await api.get(API_ENDPOINTS.PLAYGROUND_IMAGE_UPLOAD, {
    params: { permanent },
    skipErrorHandler: true,
  } as Record<string, unknown>)
  const { data } = res
  if (!data.success || !Array.isArray(data.data)) {
    return []
  }
  return data.data
}

/**
 * Delete one of the current user's playground images.
 */
export async function deletePlaygroundImage(id: number): Promise<void> {
  await api.delete(`${API_ENDPOINTS.PLAYGROUND_IMAGE_UPLOAD}/${id}`, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
}

export type PlaygroundImageAdminStats = {
  transient: {
    count: number
    total_bytes: number
    ttl_days: number
  }
  permanent: {
    count: number
    total_bytes: number
  }
  top_users: Array<{
    user_id: number
    count: number
    total_bytes: number
  }>
}

/**
 * Admin: global playground image usage stats.
 */
export async function getPlaygroundImageAdminStats(): Promise<PlaygroundImageAdminStats | null> {
  const res = await api.get('/api/playground/admin/images/stats', {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  const { data } = res
  if (!data.success || !data.data) {
    return null
  }
  return data.data
}

/**
 * Admin: manually clean up temporary playground images. all=true clears every
 * temporary image; false only clears those past the TTL.
 */
export async function cleanupPlaygroundImages(
  all: boolean
): Promise<number> {
  const res = await api.post(
    '/api/playground/admin/images/cleanup',
    { all },
    { skipErrorHandler: true } as Record<string, unknown>
  )
  const { data } = res
  if (!data.success || !data.data) {
    return 0
  }
  return data.data.deleted
}

/**
 * Generate images via the playground image relay.
 */
export async function generatePlaygroundImage(
  payload: ImageGenerationRequest,
  signal?: AbortSignal
): Promise<ImageGenerationResponse> {
  const res = await api.post(API_ENDPOINTS.IMAGE_GENERATIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Get user available models
 */
export async function getUserModels(group: string): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { group },
  })
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}
