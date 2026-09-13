// @muw-owned
import { renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { useAccountsColumns } from '../accounts-columns'

/**
 * 账户列表列定义 · 「查看」（列显隐）契约回归
 *
 * maintainer 2026-09-13 截图两个症状：
 * ① 弹层里是英文（Name / Type / Referenced / Monitoring）—— 弹层读的是 `meta.label`，
 *    而这里 header 全是函数（`() => t('X')`），读不到就退化成列 id（英文）；
 * ② 勾上最后两项后多出空白的「被引用的渠道」「套餐余量监控」重复列 —— `referenced`
 *    /`monitoring` 是纯筛选载体（cell 返回 null），本就不该出现在列显隐里。
 */
function useColumns() {
  return useAccountsColumns({
    onEdit: () => undefined,
    onDelete: () => undefined,
  })
}

describe('accounts columns · 列显隐', () => {
  test('筛选辅助列不可显隐（不属于「查看」列表）', () => {
    const { result } = renderHook(useColumns)
    const byId = new Map(result.current.map((column) => [column.id, column]))
    expect(byId.get('referenced')?.enableHiding).toBe(false)
    expect(byId.get('monitoring')?.enableHiding).toBe(false)
  })

  test('凡可显隐（= 会出现在「查看」里）的列都必须有 meta.label', () => {
    const { result } = renderHook(useColumns)
    // 与 DataTableViewOptions 的过滤条件保持一致
    const toggleable = result.current.filter(
      (column) => 'accessorFn' in column && column.enableHiding !== false
    )
    expect(toggleable.map((column) => column.id)).toEqual(['name', 'type'])
    for (const column of toggleable) {
      expect(column.meta?.label).toBeTruthy()
    }
  })

  test('操作列：右侧固定 + 列名可见（与渠道/密钥/用户表同一约定）', () => {
    const { result } = renderHook(useColumns)
    const actions = result.current.find((column) => column.id === 'actions')
    expect(actions?.meta?.pinned).toBe('right')
    // 原来写成 <span className='sr-only'>，界面上就是"操作列没有列名"
    const renderHeader = actions?.header as () => React.ReactNode
    expect(typeof renderHeader).toBe('function')
    expect(renderHeader()).toBe('Actions')
  })
})
