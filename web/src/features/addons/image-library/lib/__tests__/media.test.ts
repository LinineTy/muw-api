// @muw-owned
import { describe, expect, test } from 'vitest'

import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, isVideoExt } from '../media'

describe('isVideoExt', () => {
  test('全部受支持的视频扩展名都判定为视频', () => {
    for (const ext of VIDEO_EXTENSIONS) {
      expect(isVideoExt(ext), `${ext} 应为视频`).toBe(true)
    }
  })

  test('扩展名大小写不敏感', () => {
    expect(isVideoExt('MP4')).toBe(true)
    expect(isVideoExt('WebM')).toBe(true)
    expect(isVideoExt('MOV')).toBe(true)
  })

  test('图片扩展名与未知/空扩展名判定为非视频', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(isVideoExt(ext), `${ext} 不应判定为视频`).toBe(false)
    }
    expect(isVideoExt('txt')).toBe(false)
    expect(isVideoExt('')).toBe(false)
  })

  test('图片与视频扩展名集合无重叠', () => {
    for (const ext of VIDEO_EXTENSIONS) {
      expect(IMAGE_EXTENSIONS.has(ext), `${ext} 不应同时属于图片集合`).toBe(
        false
      )
    }
  })
})
