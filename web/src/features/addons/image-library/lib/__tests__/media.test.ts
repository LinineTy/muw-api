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
