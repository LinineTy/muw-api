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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, isVideoExt } from '../media'

describe('isVideoExt', () => {
  test('全部受支持的视频扩展名都判定为视频', () => {
    for (const ext of VIDEO_EXTENSIONS) {
      assert.equal(isVideoExt(ext), true, `${ext} 应为视频`)
    }
  })

  test('扩展名大小写不敏感', () => {
    assert.equal(isVideoExt('MP4'), true)
    assert.equal(isVideoExt('WebM'), true)
    assert.equal(isVideoExt('MOV'), true)
  })

  test('图片扩展名与未知/空扩展名判定为非视频', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      assert.equal(isVideoExt(ext), false, `${ext} 不应判定为视频`)
    }
    assert.equal(isVideoExt('txt'), false)
    assert.equal(isVideoExt(''), false)
  })

  test('图片与视频扩展名集合无重叠', () => {
    for (const ext of VIDEO_EXTENSIONS) {
      assert.equal(
        IMAGE_EXTENSIONS.has(ext),
        false,
        `${ext} 不应同时属于图片集合`
      )
    }
  })
})
