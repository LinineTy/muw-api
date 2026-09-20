// @muw-owned
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { OS_WIDGETS } from '../os-widget-registry'
import { OsPreferencesDialog } from '../os-preferences-dialog'
import { useOsNoticeStore } from '../os-notice-store'
import { useOsWidgetStore } from '../os-widget-store'

describe('OsPreferencesDialog', () => {
  beforeEach(() => {
    useOsWidgetStore.setState({ hidden: {} })
    useOsNoticeStore.setState({ collapsed: false })
  })

  it('列出注册表里的全部桌面组件（含公告卡）', () => {
    render(<OsPreferencesDialog open onOpenChange={() => {}} />)

    for (const item of OS_WIDGETS) {
      expect(
        document.querySelector(`[data-widget-toggle="${item.id}"]`)
      ).not.toBeNull()
    }
    // 公告卡以前是 menuHidden、独占一颗铃铛球，现在必须能在这里开关
    expect(
      document.querySelector('[data-widget-toggle="announcements"]')
    ).not.toBeNull()
  })

  it('普通组件开关写进 widget store', async () => {
    const user = userEvent.setup()
    render(<OsPreferencesDialog open onOpenChange={() => {}} />)

    await user.click(
      document.querySelector('[data-widget-toggle="balance"]') as HTMLElement
    )

    expect(useOsWidgetStore.getState().hidden.balance).toBe(true)
  })

  it('公告开关走 notice store（与卡片上的 × 同一个状态）', async () => {
    const user = userEvent.setup()
    render(<OsPreferencesDialog open onOpenChange={() => {}} />)

    await user.click(
      document.querySelector(
        '[data-widget-toggle="announcements"]'
      ) as HTMLElement
    )

    // 勾选=显示 => collapsed 取反
    expect(useOsNoticeStore.getState().collapsed).toBe(true)
  })

  it('鲸鱼设置项齐全（显隐/大小/音效/音效集/音量）', () => {
    render(<OsPreferencesDialog open onOpenChange={() => {}} />)

    expect(screen.getByText('Whale')).toBeInTheDocument()
    expect(screen.getByTestId('whale-visible')).toBeInTheDocument()
    expect(screen.getByTestId('whale-sound')).toBeInTheDocument()
    expect(screen.getByTestId('whale-sound-set')).toBeInTheDocument()
    expect(screen.getByLabelText('Size')).toBeInTheDocument()
    expect(screen.getByLabelText('Volume')).toBeInTheDocument()
  })
})
