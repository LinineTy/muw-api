// @muw-owned
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import type { OAuthApplication } from '../api'
import { OAuthApplicationsPage } from '../applications-page'

const APPLICATION: OAuthApplication = {
  id: 7,
  client_id: 'muw_example',
  name: 'Example app',
  description: 'Demo',
  client_type: 'public',
  status: 'pending',
  scopes: ['openid', 'profile'],
  redirect_uris: ['https://app.example.com/callback'],
  review_note: '',
  created_at: 1700000000,
  last_used_at: 0,
  owner_username: 'someone',
  apply_reason: 'Sign-in for our forum',
  allowed_groups: [],
}

function signIn(role: number) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'tester',
    role,
  })
}

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <OAuthApplicationsPage />
    </QueryClientProvider>
  )
  return client
}

function mockApi() {
  return vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/oauth/stats') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            applications: 1,
            authorizations: 0,
            token_issued: 3,
            last_issued_at: 1700000000,
            active_users: 1,
          },
        },
      })
    }
    if (url === '/api/oauth/applications/mine') {
      return Promise.resolve({
        data: { success: true, data: { items: [APPLICATION] } },
      })
    }
    if (url === '/api/oauth/consents') {
      return Promise.resolve({
        data: { success: true, data: { items: [] } },
      })
    }
    if (url === '/api/oauth/admin/applications') {
      return Promise.resolve({
        data: { success: true, data: { items: [APPLICATION], total: 1 } },
      })
    }
    throw new Error(`unexpected request: ${url}`)
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
  localStorage.removeItem('oauth-applications:view-mode')
})

test('the application list switches between the table and the card view', async () => {
  signIn(ROLE.USER)
  mockApi()
  mount()
  const user = userEvent.setup()

  await screen.findByText('Example app')
  const cardToggle = screen.getByRole('button', { name: 'Card view' })
  const tableToggle = screen.getByRole('button', { name: 'Table view' })
  // 开了卡片视图的列表默认走卡片（同订阅/账户/插件页），用户切走的选择会记住。
  expect(cardToggle).toHaveAttribute('aria-pressed', 'true')

  await user.click(tableToggle)
  expect(tableToggle).toHaveAttribute('aria-pressed', 'true')
  expect(cardToggle).toHaveAttribute('aria-pressed', 'false')
  expect(localStorage.getItem('oauth-applications:view-mode')).toBe('table')
})

test('a regular user sees their applications and authorizations, and no review queue', async () => {
  signIn(ROLE.USER)
  mockApi()
  mount()

  expect(
    screen.getByRole('tab', { name: 'My applications' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('tab', { name: 'Authorization records' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('tab', { name: 'Application review' })
  ).not.toBeInTheDocument()
  expect(await screen.findByText('Example app')).toBeInTheDocument()
  expect(screen.getByText('Pending review')).toBeInTheDocument()
})

test('an administrator can approve a pending application from the review queue', async () => {
  signIn(ROLE.ADMIN)
  mockApi()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { client_id: 'x' } } })
  mount()
  const user = userEvent.setup()

  await user.click(
    await screen.findByRole('tab', { name: 'Application review' })
  )
  await user.click(
    await screen.findByRole('button', { name: 'Approve as applied' })
  )
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('https://app.example.com/callback')
  expect(dialog).toHaveTextContent('Sign-in for our forum')

  await user.type(within(dialog).getByLabelText('Review note'), 'looks fine')
  await user.click(
    within(dialog).getByRole('button', { name: 'Approve as applied' })
  )

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/oauth/admin/applications/7/review',
      {
        action: 'approve',
        scopes: ['openid', 'profile'],
        redirect_uris: ['https://app.example.com/callback'],
        allowed_groups: [],
        note: 'looks fine',
      }
    )
  )
})

test('the apply dialog needs a name and a callback address before submitting', async () => {
  signIn(ROLE.USER)
  mockApi()
  mount()
  const user = userEvent.setup()

  await user.click(
    screen.getByRole('button', { name: 'Apply for a new application' })
  )
  const dialog = await screen.findByRole('dialog')
  const submit = within(dialog).getByRole('button', {
    name: 'Submit application',
  })
  expect(submit).toBeDisabled()

  await user.type(within(dialog).getByLabelText('Application name'), 'My app')
  await user.type(
    within(dialog).getByLabelText('Redirect URIs, one per line'),
    'https://app.example.com/callback'
  )
  expect(submit).toBeEnabled()
})
