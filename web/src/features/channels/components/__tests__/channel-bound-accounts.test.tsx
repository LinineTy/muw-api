// @muw-owned
/**
 * fork 自有用例：渠道抽屉的「账户绑定」（凭证与渠道解耦）契约。
 *
 * 上游的 channel-configuration.test.tsx 守的是上游表单/插件/批量契约（它在「手动填写」
 * 模式下跑）；这里守我们的真相源：
 *  1. 新建渠道默认「使用账户」→ 渠道侧凭证输入区（API Key / Base URL）按设计不渲染
 *  2. 绑定账户后：绑定行信息完整、说明区提示凭证来自账户
 *  3. 提交 payload 走 account_bindings，渠道自身 key 为空
 *  4. 切「手动填写」→ 清空已绑账户、渲染渠道侧凭证输入（保存时后端会自动建私有账户，
 *     该路径由 model/account_test.go 的 TestBatchInsertChannelsCreatesPrivateAccount 守）
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { ChannelsProvider } from '../channels-provider'
import { ChannelMutateDrawer } from '../drawers/channel-mutate-drawer'

// 自研账户区的「Manage in Accounts」是 tanstack Link；本文件不提供 RouterProvider
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

const originalAuth = useAuthStore.getState().auth
let client: QueryClient
/** 可绑定账户列表：用例按需调整（默认给一个可绑账户） */
let accountItems: { account: typeof boundAccount; channel_count: number; referenced: boolean }[] = []

const videoPlugin = {
  key: 'video-a',
  name: 'Video A',
  icon: 'text:VA',
  baseUrl: 'https://a.example',
  models: ['video-a-1'],
}

const boundAccount = {
  id: 7,
  name: '账户甲',
  type: 1,
  status: 1,
  key_masked: 'sk-abc****xyz',
  base_url: null,
  balance: 0,
  balance_updated_time: 0,
  other: '',
  settings: '',
  created_time: 1,
  channel_info: {},
}

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <QueryClientProvider client={client}>
      <ChannelsProvider>
        <ChannelMutateDrawer open={open} onOpenChange={setOpen} />
      </ChannelsProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  accountItems = [{ account: boundAccount, channel_count: 0, referenced: false }]
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useAuthStore.setState({
    auth: {
      ...originalAuth,
      user: { id: 1, username: 'root', role: ROLE.SUPER_ADMIN },
    },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    switch (url) {
      case '/api/group/':
        return { data: { success: true, data: ['default'] } }
      case '/api/prefill_group':
        return { data: { success: true, data: [] } }
      case '/api/task_plugin_options':
        return { data: { success: true, data: [videoPlugin] } }
      case '/api/channel/models':
        return { data: { success: true, data: [{ id: 'video-a-1' }] } }
      case '/api/account/':
        return {
          data: {
            success: true,
            data: {
              items: accountItems,
              total: accountItems.length,
              page: 1,
              page_size: 200,
            },
          },
        }
      default:
        throw new Error(`Unexpected GET ${url}`)
    }
  })
})

afterEach(() => {
  client.clear()
  useAuthStore.setState({ auth: originalAuth })
  vi.restoreAllMocks()
})

/** 「添加账户」下拉的触发器（base-ui Select 触发器的可访问名不是占位符，按文案取） */
function addAccountTrigger(): HTMLElement {
  const trigger = screen.getByText('Add account').closest('button')
  if (!trigger) {
    throw new Error('Add account trigger not found')
  }
  return trigger
}

/** 打开新建抽屉并选一个插件（插件自带 models，表单可直接提交） */
async function openPluginDraft(user: ReturnType<typeof userEvent.setup>) {
  render(<Harness />)
  await user.click(await screen.findByRole('option', { name: /Video A/ }))
  await screen.findByText('Bound accounts')
}

test('新建渠道默认「使用账户」：不渲染渠道侧凭证输入，显示已绑账户空态与上游地址只读行', async () => {
  const user = userEvent.setup()
  accountItems = [] // 没有任何可绑定账户
  await openPluginDraft(user)

  // 凭证来源切换存在，且默认选中「使用账户」
  expect(screen.getByRole('button', { name: 'Use accounts' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Manual entry' })).toBeVisible()

  // 渠道侧凭证输入按设计不渲染（真相源在账户）
  expect(screen.queryByLabelText('API Key *')).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/^Base URL/)).not.toBeInTheDocument()
  // 上游地址是只读行（账户没填地址时回落厂商内置地址）
  expect(screen.getByText('Upstream address')).toBeVisible()
  expect(screen.getByText('Provider default address')).toBeVisible()

  // 空态 + 无可添加账户时下拉禁用
  expect(screen.getByText('No account bound yet.')).toBeVisible()
  expect(addAccountTrigger()).toBeDisabled()
})

test('绑定账户后：绑定行信息完整，提交 payload 走 account_bindings 且渠道 key 为空', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  await openPluginDraft(user)

  await user.click(addAccountTrigger())
  await user.click(await screen.findByRole('option', { name: '账户甲 · OpenAI' }))

  // 绑定行：序号 + 名称 + 类型 + 打码 key + 图标操作 + 启停
  expect(screen.getByText('账户甲')).toBeVisible()
  expect(screen.getByText('sk-abc****xyz')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Move down' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remove' })).toBeVisible()
  expect(
    screen.getByRole('switch', { name: 'Enabled for this channel' })
  ).toBeChecked()
  // 说明区：凭证来自账户
  expect(
    screen.getByText(
      'Credentials come from the bound accounts. Edit keys on the account page.'
    )
  ).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Create Channel' }))
  await waitFor(() => expect(post).toHaveBeenCalled())
  const [url, payload] = post.mock.calls[0] as [
    string,
    {
      mode: string
      account_id?: number
      account_bindings?: unknown
      channel: { key?: string | null; base_url?: string | null }
    },
  ]
  expect(url).toBe('/api/channel')
  // 凭证真相源在账户：payload 顶层带绑定列表，渠道自身不带 key/地址
  expect(payload.mode).toBe('single')
  expect(payload.account_id).toBe(7)
  expect(payload.account_bindings).toEqual([{ account_id: 7, enabled: true }])
  expect(payload.channel.key ?? '').toBe('')
  expect(payload.channel.base_url ?? '').toBe('')
})

test('切「手动填写」会清空已绑账户并渲染渠道侧凭证输入', async () => {
  const user = userEvent.setup()
  await openPluginDraft(user)

  await user.click(addAccountTrigger())
  await user.click(await screen.findByRole('option', { name: '账户甲 · OpenAI' }))
  expect(screen.getByText('账户甲')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Manual entry' }))
  await waitFor(() =>
    expect(screen.getByLabelText('API Key *')).toBeInTheDocument()
  )
  expect(screen.queryByText('账户甲')).not.toBeInTheDocument()
})
