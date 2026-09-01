// @muw-owned
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Vendor: 'Vendor',
        'Model Count': 'Model Count',
        Status: 'Status',
        Enabled: 'Enabled',
        Disabled: 'Disabled',
        Created: 'Created',
        Actions: 'Actions',
        'No vendors yet': 'No vendors yet',
        'Create your first vendor to get started.':
          'Create your first vendor to get started.',
        'Edit Vendor': 'Edit Vendor',
        'Delete Vendor': 'Delete Vendor',
        'Open menu': 'Open menu',
        'New Vendor': 'New Vendor',
        Refresh: 'Refresh',
        '{{count}} vendors': '{{count}} vendors',
        'Are you sure you want to delete vendor "{{name}}"? This action cannot be undone.':
          'Are you sure you want to delete vendor "{{name}}"? This action cannot be undone.',
      },
    },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const { VendorManagementDialog } = await import('../vendor-management-dialog')
const { vendorsQueryKeys } = await import('../../../lib/query-keys')

type VendorFixture = {
  id: number
  name: string
  icon?: string
  description?: string
  status: number
  created_time: number
  updated_time: number
  model_count?: number
}

const VENDORS: VendorFixture[] = [
  {
    id: 1,
    name: 'OpenAI',
    icon: 'OpenAI',
    description: 'ChatGPT provider',
    status: 1,
    created_time: 1700000000,
    updated_time: 1700000000,
    model_count: 3,
  },
  {
    id: 2,
    name: 'Anthropic',
    status: 0,
    created_time: 1700000000,
    updated_time: 1700000000,
    model_count: 0,
  },
]

type Rendered = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

let queryClient: QueryClient

function seedVendors(items: VendorFixture[]) {
  queryClient.setQueryData(vendorsQueryKeys.list(), {
    success: true,
    data: { items, total: items.length, page: 1, page_size: 1000 },
  })
}

async function renderDialog(
  callbacks: { onEditVendor?: (vendor: VendorFixture) => void } = {}
): Promise<Rendered> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onEditVendor = callbacks.onEditVendor ?? (() => {})

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <VendorManagementDialog
            open
            onOpenChange={() => {}}
            onCreateVendor={() => {}}
            onEditVendor={onEditVendor}
          />
        </I18nextProvider>
      </QueryClientProvider>
    )
  })

  return { container, root }
}

async function unmountDialog(rendered: Rendered) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
  document.body.innerHTML = ''
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('vendor management dialog', () => {
  test('renders each vendor with name, status, and model count header', async () => {
    seedVendors(VENDORS)
    const rendered = await renderDialog()

    const text = document.body.textContent ?? ''
    expect(text.includes('OpenAI')).toBe(true)
    expect(text.includes('Anthropic')).toBe(true)
    expect(text.includes('Enabled')).toBe(true)
    expect(text.includes('Disabled')).toBe(true)
    expect(text.includes('Model Count')).toBe(true)

    await unmountDialog(rendered)
  })

  test('shows an empty state when no vendors exist', async () => {
    seedVendors([])
    const rendered = await renderDialog()

    const text = document.body.textContent ?? ''
    expect(text.includes('No vendors yet')).toBe(true)

    await unmountDialog(rendered)
  })

  test('renders vendor identity through the shared provider badge', async () => {
    seedVendors(VENDORS)
    const rendered = await renderDialog()

    const badgeCount = document.body.querySelectorAll(
      '[data-slot="provider-badge"]'
    ).length
    // One badge per vendor row.
    expect(badgeCount).toBeGreaterThanOrEqual(2)

    await unmountDialog(rendered)
  })

  test('invokes onEditVendor with the right vendor when the row edit action is clicked', async () => {
    seedVendors(VENDORS)
    const edited: VendorFixture[] = []
    const rendered = await renderDialog({
      onEditVendor: (vendor) => {
        edited.push(vendor)
      },
    })

    const editButtons = document.body.querySelectorAll(
      '[aria-label="Edit Vendor"]'
    )
    expect(editButtons.length).toBeGreaterThanOrEqual(2)
    await act(async () => {
      ;(editButtons[0] as HTMLElement).click()
    })

    // Vendors are listed sorted by name, so Anthropic is the first row.
    expect(edited.length).toBe(1)
    expect(edited[0].name).toBe('Anthropic')

    await unmountDialog(rendered)
  })

  test('opens a confirmation dialog with the vendor name when delete is clicked', async () => {
    seedVendors(VENDORS)
    const rendered = await renderDialog()

    const menuTriggers = document.body.querySelectorAll(
      '[aria-label="Open menu"]'
    )
    expect(menuTriggers.length).toBeGreaterThanOrEqual(2)
    await act(async () => {
      ;(menuTriggers[0] as HTMLElement).click()
    })

    const deleteItems = [
      ...document.body.querySelectorAll('[role="menuitem"]'),
    ].filter((el) => (el.textContent ?? '').includes('Delete Vendor'))
    expect(deleteItems.length).toBeGreaterThan(0)
    await act(async () => {
      ;(deleteItems[0] as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      )
    })

    const confirmText = document.body.textContent ?? ''
    expect(
      confirmText.includes(
        'Are you sure you want to delete vendor "Anthropic"?'
      ),
      'expected the delete confirmation dialog to show the vendor name'
    ).toBe(true)

    await unmountDialog(rendered)
  })
})
