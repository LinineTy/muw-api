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
import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, test } from 'node:test'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Window } from 'happy-dom'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'matchMedia',
  'customElements',
  'localStorage',
  'sessionStorage',
  'ResizeObserver',
  'IntersectionObserver',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

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

after(() => {
  domWindow.close()
})

describe('vendor management dialog', () => {
  test('renders each vendor with name, status, and model count header', async () => {
    seedVendors(VENDORS)
    const rendered = await renderDialog()

    const text = document.body.textContent ?? ''
    assert.equal(text.includes('OpenAI'), true)
    assert.equal(text.includes('Anthropic'), true)
    assert.equal(text.includes('Enabled'), true)
    assert.equal(text.includes('Disabled'), true)
    assert.equal(text.includes('Model Count'), true)

    await unmountDialog(rendered)
  })

  test('shows an empty state when no vendors exist', async () => {
    seedVendors([])
    const rendered = await renderDialog()

    const text = document.body.textContent ?? ''
    assert.equal(text.includes('No vendors yet'), true)

    await unmountDialog(rendered)
  })

  test('renders vendor identity through the shared provider badge', async () => {
    seedVendors(VENDORS)
    const rendered = await renderDialog()

    const badgeCount = document.body.querySelectorAll(
      '[data-slot="provider-badge"]'
    ).length
    // One badge per vendor row.
    assert.ok(badgeCount >= 2)

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
    assert.ok(editButtons.length >= 2)
    await act(async () => {
      ;(editButtons[0] as HTMLElement).click()
    })

    // Vendors are listed sorted by name, so Anthropic is the first row.
    assert.equal(edited.length, 1)
    assert.equal(edited[0].name, 'Anthropic')

    await unmountDialog(rendered)
  })

  test('opens a confirmation dialog with the vendor name when delete is clicked', async () => {
    seedVendors(VENDORS)
    const rendered = await renderDialog()

    const menuTriggers = document.body.querySelectorAll(
      '[aria-label="Open menu"]'
    )
    assert.ok(menuTriggers.length >= 2)
    await act(async () => {
      ;(menuTriggers[0] as HTMLElement).click()
    })

    const deleteItems = [
      ...document.body.querySelectorAll('[role="menuitem"]'),
    ].filter((el) => (el.textContent ?? '').includes('Delete Vendor'))
    assert.ok(deleteItems.length > 0)
    await act(async () => {
      ;(deleteItems[0] as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      )
    })

    const confirmText = document.body.textContent ?? ''
    assert.equal(
      confirmText.includes(
        'Are you sure you want to delete vendor "Anthropic"?'
      ),
      true,
      'expected the delete confirmation dialog to show the vendor name'
    )

    await unmountDialog(rendered)
  })
})
