// @muw-owned
import { beforeEach, describe, expect, test } from 'vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { LandingManual } from '../../types'

// Base UI ScrollArea checks running animations; jsdom does not implement
// Element.getAnimations, so polyfill it as "no animations".
(HTMLElement.prototype as unknown as {
  getAnimations: () => unknown[]
}).getAnimations = () => []

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

describe('ManualThemeEditorDialog', () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
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
    expect(popup, '弹窗打开时应渲染弹层').toBeTruthy()
    // expect() does not narrow the type; guard so the queries below are typed.
    if (!popup) throw new Error('dialog content not rendered')

    // 回归:弹层必须限高并裁剪,内部滚动——而不是随内容(四个 auto-grow 输入框)
    // 撑高超过屏幕导致无法滚动。
    // 上游 2026-09-19 把弹层基类从 `overflow-hidden + max-h-[calc(100vh-2rem)]`
    // 改为 `overflow-x-hidden overflow-y-auto + max-h-(--dialog-available-height)`
    // （移动端工具栏遮挡修复），判据跟着放宽到「横向裁剪 + 纵向可滚 + 有限高」。
    expect(
      popup.classList.contains('overflow-x-hidden'),
      '弹层应横向裁剪溢出内容'
    ).toBe(true)
    expect(
      popup.classList.contains('overflow-y-auto') ||
        [...popup.querySelectorAll('*')].some((el) =>
          (el as HTMLElement).classList.contains('overflow-y-auto')
        ),
      '弹层应可纵向滚动'
    ).toBe(true)
    expect(
      [...popup.classList].some((c) => c.startsWith('max-h-')),
      '弹层应限制最大高度,不超出视口'
    ).toBe(true)
    const scrollBody = [...popup.querySelectorAll('*')].find((el) =>
      (el as HTMLElement).classList.contains('overflow-y-auto')
    )
    expect(scrollBody, '弹层内部应有可滚动区域').toBeTruthy()

    // 回归:四个页面的内容框对长 HTML(整行 URL/压缩样式)折行,不横向溢出。
    const textareas = popup.querySelectorAll('[data-slot="textarea"]')
    expect(textareas.length, '应渲染四个页面的内容框').toBe(4)
    for (const ta of textareas) {
      expect(
        ta.classList.contains('[overflow-wrap:anywhere]'),
        '内容框应对长 token 折行'
      ).toBe(true)
    }

    await act(async () => root.unmount())
    container.remove()
  })
})
