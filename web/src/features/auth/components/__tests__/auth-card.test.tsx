// @muw-owned
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BADGE_CLEARANCE } from '../../lib/auth-card-geometry'
import { AuthCard } from '../auth-card'

describe('AuthCard（认证页卡壳）', () => {
  it('渲染卡外标题区、主卡内容、底部次要文字与右下叠卡', () => {
    render(
      <AuthCard
        title='登录'
        subtitle='还没有账号？注册。'
        badge='secure'
        badgeLabel='连接安全'
        footer={<button type='button'>使用账号密码登录</button>}
      >
        <div>表单内容</div>
      </AuthCard>
    )

    expect(screen.getByRole('heading', { name: '登录' })).toBeDefined()
    expect(screen.getByText('还没有账号？注册。')).toBeDefined()
    expect(screen.getByText('表单内容')).toBeDefined()
    expect(screen.getByText('使用账号密码登录')).toBeDefined()
    expect(screen.getByText('连接安全')).toBeDefined()
  })

  it('不传 badge 时不渲染叠卡，也不渲染底部文字带', () => {
    render(
      <AuthCard title='激活账号'>
        <div>表单内容</div>
      </AuthCard>
    )

    expect(screen.queryByText('连接安全')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('有角标但没有底部入口时，底留区仍要留出角标侵入的高度', () => {
    const { container } = render(
      <AuthCard title='登录' badge='secure' badgeLabel='连接安全'>
        <div>表单内容</div>
      </AuthCard>
    )

    const card = container.querySelector('[data-slot=card]') as HTMLElement
    const spacer = card.lastElementChild as HTMLElement
    expect(Number.parseFloat(spacer.style.height)).toBeGreaterThanOrEqual(
      BADGE_CLEARANCE
    )
  })

  it('既无角标也无底部入口时底留区保持紧凑', () => {
    const { container } = render(
      <AuthCard title='登录'>
        <div>表单内容</div>
      </AuthCard>
    )

    const card = container.querySelector('[data-slot=card]') as HTMLElement
    const spacer = card.lastElementChild as HTMLElement
    expect(spacer.style.height).toBe('')
    expect(spacer.className).toContain('h-4')
  })
})
