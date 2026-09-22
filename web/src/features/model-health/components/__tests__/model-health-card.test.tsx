// @muw-owned
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ModelHealthRow } from '../../types'
import { ModelHealthCard } from '../model-health-card'

function row(channelId: number): ModelHealthRow {
  return {
    channel_id: channelId,
    channel_name: `channel-${channelId}`,
    model_name: 'gpt-x',
    test_count: 10,
    success_count: 10,
    success_rate: 100,
    avg_response_time: 120,
    last_response_time: 120,
    last_test_time: 1789890000,
    last_error: '',
    trend: [{ created_at: 1789890000, response_time: 120, success: true }],
  }
}

const rows = [row(1), row(2), row(3)]

const tiles = () =>
  document.querySelectorAll('[data-slot="channel-health-tile"]')

describe('ModelHealthCard 隐藏渠道', () => {
  // jsdom 里容器宽度为 0 → 每页 1 张，3 个渠道就是 3 页，正好能看到翻页器
  it('hideChannels=false：渲染渠道瓷砖与翻页器', () => {
    render(
      <ModelHealthCard modelName='gpt-x' rows={rows} hideChannels={false} />
    )

    expect(tiles()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })

  it('hideChannels=true：瓷砖与翻页器都不渲染，头部信息保留', () => {
    render(<ModelHealthCard modelName='gpt-x' rows={rows} hideChannels />)

    expect(tiles()).toHaveLength(0)
    expect(
      screen.queryByRole('button', { name: 'Next' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
    expect(screen.getByText('gpt-x')).toBeInTheDocument()
  })
})
