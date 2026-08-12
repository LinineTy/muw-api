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

// 图床图片记录(与后端 model.ImageAsset 对应)。
export type ImageAsset = {
  id: number
  name: string
  /** 相对路径,如 /uploads/images/1.png */
  url: string
  size: number
  uploader_id: number
  created_time: number
}

export type ImageListResponse = {
  success: boolean
  message?: string
  data?: ImageAsset[]
}

export type UploadImageResponse = {
  success: boolean
  message?: string
  data?: { id: number; url: string }
}

export type SimpleResponse = {
  success: boolean
  message?: string
}
