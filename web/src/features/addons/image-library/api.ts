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
  ImageListResponse,
  SimpleResponse,
  UploadImageResponse,
} from './types'

export async function getImages(): Promise<ImageListResponse> {
  const res = await api.get('/api/images/')
  return res.data
}

// 上传图片:multipart 字段 file,后端存 <UploadDir>/images/<id>.<ext>。
export async function uploadImage(file: File): Promise<UploadImageResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post('/api/images/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function deleteImage(id: number): Promise<SimpleResponse> {
  const res = await api.delete(`/api/images/${id}`)
  return res.data
}
