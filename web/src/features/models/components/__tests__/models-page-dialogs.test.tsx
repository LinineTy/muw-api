import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'

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
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const { ModelsProvider } = await import('../models-provider')
const { ModelsPrimaryButtons } = await import('../models-primary-buttons')
const { ModelsDialogs } = await import('../models-dialogs')
const { SectionPageLayout } = await import('@/components/layout')
const { vendorsQueryKeys } = await import('../../lib/query-keys')

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(['system-options'], { success: true, data: [] })
  queryClient.setQueryData(vendorsQueryKeys.list(), {
    success: true,
    data: { items: [], total: 0, page: 1, page_size: 1000 },
  })
})

after(() => {
  domWindow.close()
})

test('Add Model opens the drawer when ModelsDialogs lives outside SectionPageLayout', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <ModelsProvider>
            <SectionPageLayout fixedContent>
              <SectionPageLayout.Actions>
                <ModelsPrimaryButtons
                  batchMode={false}
                  onBatchModeChange={() => {}}
                />
              </SectionPageLayout.Actions>
              <SectionPageLayout.Content>
                <div>content</div>
              </SectionPageLayout.Content>
            </SectionPageLayout>
            <ModelsDialogs />
          </ModelsProvider>
        </I18nextProvider>
      </QueryClientProvider>
    )
  })

  const addBtn = [...document.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === 'Add Model'
  )
  assert.ok(addBtn, 'Add Model button should be found')

  await act(async () => {
    addBtn.click()
  })

  // Regression: ModelsDialogs must render (it is a sibling of SectionPageLayout,
  // not a child — SectionPageLayout drops any child that is not one of its
  // Title/Actions/Content/Breadcrumb slots).
  const sheet = document.querySelector('[data-slot="sheet-content"]')
  assert.ok(sheet, 'drawer should open after clicking Add Model')
  assert.ok(
    (document.body.textContent ?? '').includes('Create Model'),
    'drawer should render the Create Model form'
  )

  await act(async () => root.unmount())
  container.remove()
})
