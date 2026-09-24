// @muw-owned
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'

import { OAuthProviders } from '../oauth-providers'

const asStatus = (value: Partial<SystemStatus>) => value as SystemStatus

const ALL_PROVIDERS: Partial<SystemStatus> = {
  wechat_login: true,
  github_oauth: true,
  discord_oauth: true,
  oidc_enabled: true,
  linuxdo_oauth: true,
  telegram_oauth: true,
}

// 图标是内联 SVG（自带文案节点），textContent 会把它和按钮文案连在一起，所以用包含判断。
const renderedLabels = () =>
  screen.getAllByRole('button').map((button) => button.textContent?.trim() ?? '')

const expectLabels = (expected: string[]) => {
  const labels = renderedLabels()
  expect(labels).toHaveLength(expected.length)
  expected.forEach((label) =>
    expect(labels.some((text) => text.includes(label))).toBe(true)
  )
}

describe('OAuthProviders 渲染哪些入口', () => {
  it('渲染全部已配置的提供方，顺序稳定', () => {
    render(
      <OAuthProviders
        status={asStatus(ALL_PROVIDERS)}
        onWeChatLogin={() => undefined}
      />
    )

    expectLabels([
      'Continue with WeChat',
      'Continue with GitHub',
      'Continue with Discord',
      'Continue with OIDC',
      'Continue with LinuxDO',
      'Continue with Telegram',
    ])
  })

  it('什么都没配（或没给微信回调）时不渲染，也不留分隔线', () => {
    const none = render(<OAuthProviders status={asStatus({})} />)
    expect(none.container.textContent).toBe('')

    const wechatWithoutCallback = render(
      <OAuthProviders status={asStatus({ wechat_login: true })} />
    )
    expect(wechatWithoutCallback.container.textContent).toBe('')
  })
})
