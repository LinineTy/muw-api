// @muw-owned
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { BillingTimeRangeFields } from '../billing-time-fields'

// 星期是枚举：范围两端必须渲染成「星期X」下拉，而不是原始数字（1 至 6）。
// 回归目标：`BillingConditionValueInput` 原先要求 `!normalizeNumberDrafts` 才走下拉，
// 于是传了 normalizeNumberDrafts 的乘数区（请求规则）退回数字输入框 —— 2026-09-13 截图发现。
it('renders weekday range bounds as day-name selects even with number drafts enabled', () => {
  render(
    <BillingTimeRangeFields
      probe='weekday'
      normalizeNumberDrafts
      start='1'
      end='6'
      onChange={() => {}}
    />
  )
  expect(screen.getByRole('combobox', { name: 'Start weekday' })).toHaveTextContent(
    'Monday'
  )
  expect(screen.getByRole('combobox', { name: 'End weekday' })).toHaveTextContent(
    'Saturday'
  )
})

// 非星期探针保持数字草稿输入（normalizeNumberDrafts 的原有语义不变）。
it('keeps numeric drafts for non-weekday probes', () => {
  render(
    <BillingTimeRangeFields
      probe='hour'
      normalizeNumberDrafts
      start='14'
      end='18'
      onChange={() => {}}
    />
  )
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByLabelText('Start')).toHaveValue(14)
  expect(screen.getByLabelText('End')).toHaveValue(18)
})

// 星期 0 = 星期日（Go time.Weekday），下拉必须是完整 7 天、顺序 日→六，
// 且选「星期日」写回的仍是 0（后端唯一认的周日值）。
it('offers all seven days including Sunday and writes 0 back', async () => {
  const onChange = vi.fn()
  render(
    <BillingTimeRangeFields
      probe='weekday'
      normalizeNumberDrafts
      start='1'
      end='6'
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('combobox', { name: 'Start weekday' }))
  const options = await screen.findAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual([
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ])
  await userEvent.click(screen.getByRole('option', { name: 'Sunday' }))
  expect(onChange).toHaveBeenCalledWith('0', '6')
})
