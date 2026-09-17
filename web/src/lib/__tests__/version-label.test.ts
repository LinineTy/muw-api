// @muw-owned
import { describe, expect, test } from 'vitest'

import {
  formatVersionLabel,
  parseVersionLabel,
} from '@/lib/version-label'

// 假翻译器：只需要能拼出 build 段
const t = ((key: string, options?: Record<string, unknown>) =>
  key === 'build {{n}}' ? `第 ${options?.n} 版` : key) as never

describe('parseVersionLabel', () => {
  test('解析日期制版本号（含当天第几个）', () => {
    expect(parseVersionLabel('v26.09.18.muw.1')).toEqual({
      date: '2026-09-18',
      build: 1,
    })
    expect(parseVersionLabel('v26.09.18.muw.23')).toEqual({
      date: '2026-09-18',
      build: 23,
    })
  })

  test('没有 muw 段的日期版本号只有日期', () => {
    expect(parseVersionLabel('v26.09.18')).toEqual({
      date: '2026-09-18',
      build: undefined,
    })
  })

  test('非日期制版本号解析不出（原样展示）', () => {
    expect(parseVersionLabel('v1.0.0-rc.36')).toBeNull()
    expect(parseVersionLabel('latest')).toBeNull()
    expect(parseVersionLabel('')).toBeNull()
    expect(parseVersionLabel(undefined)).toBeNull()
  })
})

describe('formatVersionLabel', () => {
  test('full：日期 · 第几版', () => {
    expect(formatVersionLabel('v26.09.18.muw.1', t)).toBe('2026-09-18 · 第 1 版')
    expect(formatVersionLabel('v26.09.18.muw.23', t)).toBe(
      '2026-09-18 · 第 23 版'
    )
  })

  test('compact：只给"第几版"（调用处已单独显示日期）', () => {
    expect(formatVersionLabel('v26.09.18.muw.1', t, { style: 'compact' })).toBe(
      '第 1 版'
    )
  })

  test('无 muw 段：full 只给日期，compact 退回原串', () => {
    expect(formatVersionLabel('v26.09.18', t)).toBe('2026-09-18')
    expect(formatVersionLabel('v26.09.18', t, { style: 'compact' })).toBe(
      'v26.09.18'
    )
  })

  test('非日期制版本号原样返回（不误伤上游 semver）', () => {
    expect(formatVersionLabel('v1.0.0-rc.36', t)).toBe('v1.0.0-rc.36')
    expect(
      formatVersionLabel('v1.0.0-rc.36', t, { style: 'compact' })
    ).toBe('v1.0.0-rc.36')
  })

  test('空值返回空串（调用处自己兜底）', () => {
    expect(formatVersionLabel('', t)).toBe('')
    expect(formatVersionLabel('   ', t)).toBe('')
    expect(formatVersionLabel(undefined, t)).toBe('')
    expect(formatVersionLabel(null, t)).toBe('')
  })
})
