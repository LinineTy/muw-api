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

/**
 * Playground images are private (served only through ownership-checked API
 * endpoints), so the browser must fetch each one with the auth token and turn it
 * into a data URL before it can be displayed or sent to a model. Results are
 * cached for the session so repeated display/send does not re-fetch.
 */

// dataUrlCache 会话内缓存上限：单张图最大 5MB（base64 ~6.7MB），长会话无限累积
// 会让内存只增不减，这里按条数限制并淘汰最旧。
const MAX_DATA_URL_CACHE_ENTRIES = 100
const dataUrlCache = new Map<string, string>()
const inflightCache = new Map<string, Promise<string | null>>()

function cacheDataUrl(url: string, dataUrl: string): void {
  if (dataUrlCache.size >= MAX_DATA_URL_CACHE_ENTRIES) {
    const oldest = dataUrlCache.keys().next()
    if (!oldest.done) {
      dataUrlCache.delete(oldest.value)
    }
  }
  dataUrlCache.set(url, dataUrl)
}

/**
 * Resolve a private playground image URL to a base64 data URL, or null on error.
 */
export async function resolveImageDataUrl(url: string): Promise<string | null> {
  const cached = dataUrlCache.get(url)
  if (cached) {
    return cached
  }

  const inflight = inflightCache.get(url)
  if (inflight) {
    return inflight
  }

  const promise = (async () => {
    try {
      const res = await api.get(url, {
        responseType: 'blob',
        skipErrorHandler: true,
      } as Record<string, unknown>)
      const blob = res.data as Blob
      if (!(blob instanceof Blob) || blob.size === 0) {
        return null
      }
      // 文件缺失/已 GC 时接口会返回 {success:false} 的 JSON 错误体，被包装成
      // application/json blob；拒绝非图片类型，避免 data:application/json 破图。
      if (!blob.type.startsWith('image/')) {
        return null
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(reader.result as string))
        reader.addEventListener('error', () =>
          reject(reader.error ?? new Error('Failed to read image'))
        )
        reader.readAsDataURL(blob)
      })
      cacheDataUrl(url, dataUrl)
      return dataUrl
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to resolve image data url:', url, error)
      return null
    } finally {
      inflightCache.delete(url)
    }
  })()

  inflightCache.set(url, promise)
  return promise
}

/**
 * Resolve a list of attachment URLs to data URLs, reporting how many failed to
 * load. The caller decides whether to surface the failures — silently dropping a
 * failed image (especially in a pure-image message) would mislead the user into
 * thinking the image was sent.
 */
export async function resolveAttachmentsDataUrls(
  urls: string[]
): Promise<{ urls: string[]; failed: number }> {
  if (urls.length === 0) {
    return { urls: [], failed: 0 }
  }
  const results = await Promise.all(urls.map((url) => resolveImageDataUrl(url)))
  const dataUrls = results.filter(
    (dataUrl): dataUrl is string => dataUrl !== null
  )
  return { urls: dataUrls, failed: urls.length - dataUrls.length }
}
