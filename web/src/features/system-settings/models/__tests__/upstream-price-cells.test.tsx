// @muw-owned
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SyncPriceCell } from '../upstream-price-cells'

/**
 * 源价表达式的逐词差值高亮（上游 6c14c0762）：只有两侧表达式“词数相同”时
 * 才逐位比较，并高亮来源侧不同的词；形状不同则原样显示。
 */
describe('SyncPriceCell expression diff', () => {
  it('marks only the differing word when both expressions share one shape', () => {
    const { container } = render(
      <SyncPriceCell
        values={{ billing_mode: 'tiered_expr', billing_expr: 'setup 1 fee' }}
        compareTo={{ billing_mode: 'tiered_expr', billing_expr: 'setup 2 fee' }}
      />
    )
    // 单元格渲染的是 values（= 来源侧表达式），高亮的是它相对 compareTo 不同的词
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('1')
  })

  it('leaves the expression untouched when the shapes differ', () => {
    const { container } = render(
      <SyncPriceCell
        values={{ billing_mode: 'tiered_expr', billing_expr: 'setup 1 fee' }}
        compareTo={{
          billing_mode: 'tiered_expr',
          billing_expr: 'setup 2 fee per call',
        }}
      />
    )
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container.textContent).toContain('setup 1 fee')
  })

  it('does not mark anything without a comparison expression', () => {
    const { container } = render(
      <SyncPriceCell
        values={{ billing_mode: 'tiered_expr', billing_expr: 'setup 1 fee' }}
      />
    )
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })
})
