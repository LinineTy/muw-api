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

describe('OAuthProviders 的 only 过滤', () => {
  it('only=[wechat] 时只渲染微信入口，其它第三方一个都不放（注册页用）', () => {
    render(
      <OAuthProviders
        status={asStatus(ALL_PROVIDERS)}
        only={['wechat']}
        onWeChatLogin={() => undefined}
      />
    )

    expectLabels(['Continue with WeChat'])
  })

  it('不传 only 时渲染全部已配置的提供方（登录页行为不变）', () => {
    render(
      <OAuthProviders status={asStatus(ALL_PROVIDERS)} onWeChatLogin={() => undefined} />
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

  it('only 里的提供方没配置（或没给回调）时不渲染任何东西，也不留分隔线', () => {
    const noProvider = render(
      <OAuthProviders status={asStatus({})} only={['wechat']} onWeChatLogin={() => undefined} />
    )
    expect(noProvider.container.textContent).toBe('')

    const noCallback = render(
      <OAuthProviders status={asStatus({ wechat_login: true })} only={['wechat']} />
    )
    expect(noCallback.container.textContent).toBe('')
  })
})
