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
  LandingManual,
  LandingThemeDetailResponse,
  LandingThemeListResponse,
  SimpleResponse,
} from './types'

export async function getLandingThemes(): Promise<LandingThemeListResponse> {
  const res = await api.get('/api/home-page-theme/')
  return res.data
}

export async function getLandingTheme(
  id: string
): Promise<LandingThemeDetailResponse> {
  const res = await api.get(`/api/home-page-theme/${id}`)
  return res.data
}

// 导入主题:multipart 上传 .zip 或 .html(FormData 字段 name + file)。
export async function importLandingTheme(body: {
  name: string
  file: File
}): Promise<SimpleResponse> {
  const formData = new FormData()
  formData.append('name', body.name)
  formData.append('file', body.file)
  const res = await api.post('/api/home-page-theme/', formData)
  return res.data
}

export async function selectLandingTheme(id: string): Promise<SimpleResponse> {
  const res = await api.post('/api/home-page-theme/select', { id })
  return res.data
}

// 保存手动预设并生效(切到手动模式)。
export async function updateManualTheme(
  body: LandingManual
): Promise<SimpleResponse> {
  const res = await api.put('/api/home-page-theme/manual', body)
  return res.data
}

export async function deleteLandingTheme(id: string): Promise<SimpleResponse> {
  const res = await api.delete(`/api/home-page-theme/${id}`)
  return res.data
}
