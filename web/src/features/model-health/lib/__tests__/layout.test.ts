// @muw-owned
import { describe, expect, test } from 'vitest'

import {
  TILE_MAX_PER_PAGE,
  clampPage,
  pageCount,
  perPageForWidth,
} from '@/features/model-health/lib/layout'

describe('perPageForWidth', () => {
  test('按容器宽度算每页张数（178px 一张 + 6px 间距）', () => {
    expect(perPageForWidth(546)).toBe(3) // 半宽模型卡（两列布局）
    expect(perPageForWidth(1128)).toBe(6) // 整行模型卡
    expect(perPageForWidth(340)).toBe(1) // 手机
    expect(perPageForWidth(178)).toBe(1)
    expect(perPageForWidth(184 + 178)).toBe(2)
  })

  test('量不到宽度时兜底 1 张，超宽屏有上限', () => {
    expect(perPageForWidth(0)).toBe(1)
    expect(perPageForWidth(-100)).toBe(1)
    expect(perPageForWidth(Number.NaN)).toBe(1)
    expect(perPageForWidth(99999)).toBe(TILE_MAX_PER_PAGE)
  })
})

describe('pageCount / clampPage', () => {
  test('页数向上取整，空列表也算 1 页', () => {
    expect(pageCount(5, 3)).toBe(2)
    expect(pageCount(3, 3)).toBe(1)
    expect(pageCount(1, 3)).toBe(1)
    expect(pageCount(7, 3)).toBe(3)
    expect(pageCount(0, 3)).toBe(1)
  })

  test('页码夹紧，窗口缩放不会把页码顶出去', () => {
    expect(clampPage(-1, 2)).toBe(0)
    expect(clampPage(0, 2)).toBe(0)
    expect(clampPage(1, 2)).toBe(1)
    expect(clampPage(5, 2)).toBe(1)
    expect(clampPage(3, 1)).toBe(0)
  })
})
