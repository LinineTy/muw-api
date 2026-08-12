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
import { after, beforeEach, test } from 'node:test'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Window } from 'happy-dom'

import type { LandingManual } from '../../types'

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

const { ManualThemeEditorDialog } =
  await import('../manual-theme-editor-dialog')
const EMPTY_MANUAL: LandingManual = {
  home: '',
  about: '',
  user_agreement: '',
  privacy_policy: '',
}

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
})

after(() => {
  domWindow.close()
})

test('手动配置弹窗内容超高时在弹层内滚动,长 HTML 不横向溢出', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <ManualThemeEditorDialog
            open
            initial={EMPTY_MANUAL}
            onOpenChange={() => {}}
          />
        </I18nextProvider>
      </QueryClientProvider>
    )
  })

  const popup = document.querySelector('[data-slot="dialog-content"]')
  assert.ok(popup, '弹窗打开时应渲染弹层')

  // 回归:弹层必须限高并裁剪,内部滚动——而不是随内容(四个 auto-grow 输入框)
  // 撑高超过屏幕导致无法滚动。
  assert.ok(popup.classList.contains('overflow-hidden'), '弹层应裁剪溢出内容')
  assert.ok(
    [...popup.classList].some((c) => c.startsWith('max-h-[')),
    '弹层应限制最大高度,不超出视口'
  )
  const scrollBody = [...popup.querySelectorAll('*')].find((el) =>
    (el as HTMLElement).classList.contains('overflow-y-auto')
  )
  assert.ok(scrollBody, '弹层内部应有可滚动区域')

  // 回归:四个页面的内容框对长 HTML(整行 URL/压缩样式)折行,不横向溢出。
  const textareas = popup.querySelectorAll('[data-slot="textarea"]')
  assert.equal(textareas.length, 4, '应渲染四个页面的内容框')
  for (const ta of textareas) {
    assert.ok(
      ta.classList.contains('[overflow-wrap:anywhere]'),
      '内容框应对长 token 折行'
    )
  }

  await act(async () => root.unmount())
  container.remove()
})
