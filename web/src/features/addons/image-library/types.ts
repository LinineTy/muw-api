// @muw-owned
// 图床媒体记录(与后端 model.ImageAsset 对应)。ext 决定前端按图片或视频渲染。
export type ImageAsset = {
  id: number
  name: string
  /** 文件扩展名,如 png/mp4/webm */
  ext: string
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
