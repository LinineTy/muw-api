// @muw-owned
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
