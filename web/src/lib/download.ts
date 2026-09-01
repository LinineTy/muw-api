// @muw-owned
/**
 * Trigger a client-side download of the given string content as a file.
 */
export function downloadBlob(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 延迟 revoke：click 后立即 revoke 在部分浏览器（旧 Safari/Firefox）会中断下载。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Download a Blob directly (used for binary image downloads).
 */
export function downloadBlobObject(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
