// @muw-owned
// 图床支持的媒体类型判定,供上传对话框与画廊卡片共用。
// 后端按内容魔数校验并决定扩展名,前端据此区分图片/视频渲染。

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv'])

/** 按扩展名判断是否为视频（画廊卡片用，ext 来自后端存储）。 */
export function isVideoExt(ext: string): boolean {
  return VIDEO_EXTENSIONS.has(ext.toLowerCase())
}
