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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAccountCodingPlanQuota } from '../../api'
import type { Account, AccountCodingPlanQuota } from '../../types'
import { CodingPlanQuotaCell } from '../coding-plan-quota-cell'

vi.mock('../../api', () => ({
  getAccountCodingPlanQuota: vi.fn(),
}))

const account = {
  id: 7,
  coding_plan_provider: 'zhipu',
} as unknown as Account

function renderCell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CodingPlanQuotaCell account={account} autoRefresh={false} />
    </QueryClientProvider>
  )
}

const quota: AccountCodingPlanQuota = {
  success: true,
  level: 'Pro',
  queried_at: 1757000000,
  tiers: [
    {
      name: 'five_hour',
      utilization: 38,
      resets_at: '2026-08-24T18:00:00+08:00',
    },
    {
      name: 'monthly_limit',
      utilization: 12,
      resets_at: '2026-09-01T00:00:00+08:00',
    },
    {
      name: 'weekly_limit',
      utilization: 5,
      resets_at: '2026-08-26T00:00:00+08:00',
    },
  ],
}

describe('CodingPlanQuotaCell 余量详情', () => {
  beforeEach(() => {
    vi.mocked(getAccountCodingPlanQuota).mockResolvedValue(quota)
  })

  // 2026-09-13 反馈：重置时间原先只挂在 `title` 上（手机没有悬停 ⇒ 看不到）。
  // 现在点条条开**居中弹窗**，所有窗口的数据条与完整重置时间都在里面。
  it('点条条开居中弹窗，里面列出全部窗口的数据条', async () => {
    const user = userEvent.setup()
    renderCell()

    const bar = await screen.findByRole('button', {
      name: /5h · Remaining 62%/,
    })
    await user.click(bar)

    const dialog = await screen.findByRole('dialog')
    // 窗口名齐全
    expect(within(dialog).getByText('5h')).toBeInTheDocument()
    expect(within(dialog).getByText('Monthly')).toBeInTheDocument()
    expect(within(dialog).getByText('Weekly')).toBeInTheDocument()
    // 已使用口径
    expect(within(dialog).getByText('Used 38%')).toBeInTheDocument()
    expect(within(dialog).getByText('Used 12%')).toBeInTheDocument()
  })

  it('弹窗里的重置时间是完整时间（含年份），不是单元格里的紧凑格式', async () => {
    const user = userEvent.setup()
    renderCell()

    await user.click(
      await screen.findByRole('button', { name: /Monthly · Remaining 88%/ })
    )

    const dialog = await screen.findByRole('dialog')
    const resetLines = within(dialog).getAllByText(/^Reset /)
    expect(resetLines).toHaveLength(3)
    for (const line of resetLines) {
      expect(line).toHaveTextContent(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    }
  })

  it('弹窗里也保留厂商原始数值（limit/remaining）', async () => {
    vi.mocked(getAccountCodingPlanQuota).mockResolvedValue({
      ...quota,
      tiers: [
        {
          name: 'five_hour',
          utilization: 40,
          resets_at: '2026-08-24T18:00:00+08:00',
          limit: 1000,
          remaining: 600,
        },
      ],
    })
    const user = userEvent.setup()
    renderCell()

    await user.click(
      await screen.findByRole('button', { name: /5h · Remaining 60%/ })
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Total 1000 · Remaining 600')).toBeInTheDocument()
  })

  // 2026-09-21：credits 类厂商（Command Code）的额度是小数，DTO 也改成小数了 ⇒
  // 弹窗要照原样显示两位小数，而不是取整成 13 / 70。
  it('小数额度照原样显示（credits 类厂商）', async () => {
    vi.mocked(getAccountCodingPlanQuota).mockResolvedValue({
      ...quota,
      tiers: [
        {
          name: 'monthly_limit',
          utilization: 0.9,
          resets_at: '2026-10-21T07:47:30.000Z',
          limit: 70,
          remaining: 69.929046866,
          used: 0.070953134,
        },
      ],
    })
    const user = userEvent.setup()
    renderCell()

    await user.click(
      await screen.findByRole('button', { name: /Monthly · Remaining 99.1%/ })
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Total 70 · Remaining 69.93')
    ).toBeInTheDocument()
  })

  // 2026-09-21：窗口外的额外额度（额外购买 + 赠送）单独一行，画成进度条没意义。
  it('额外额度单独一行显示（购买 + 赠送）', async () => {
    vi.mocked(getAccountCodingPlanQuota).mockResolvedValue({
      ...quota,
      extra: { purchased: 12.5, free: 2.5 },
    })
    const user = userEvent.setup()
    renderCell()

    await user.click(
      await screen.findByRole('button', { name: /5h · Remaining 62%/ })
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Extra credits/)).toHaveTextContent(
      'Extra credits 15 · Purchased 12.50 · Free credits 2.50'
    )
  })

  it('没有额外额度时不显示这一行', async () => {
    const user = userEvent.setup()
    renderCell()

    await user.click(
      await screen.findByRole('button', { name: /5h · Remaining 62%/ })
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(/Extra credits/)).toBeNull()
  })
})
