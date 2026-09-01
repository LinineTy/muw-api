// @muw-owned
import { afterAll, describe, expect, test } from 'vitest'

// Base UI ScrollArea checks running animations; jsdom does not implement
// Element.getAnimations, so polyfill it as "no animations".
(HTMLElement.prototype as unknown as {
  getAnimations: () => unknown[]
}).getAnimations = () => []

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { AnnouncementDialog } = await import('../../announcement-dialog')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'System Announcements': 'System Announcements',
        'Got it': 'Got it',
        'Got it ({{count}}s)': 'Got it ({{count}}s)',
        'Hide for Today': 'Hide for Today',
      },
    },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function findFooterButton(text: string): HTMLButtonElement | undefined {
  const footer = document.querySelector('[data-slot="dialog-footer"]')
  if (!footer) return undefined
  return [...footer.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text)
  ) as HTMLButtonElement | undefined
}

function findCheckbox(): HTMLElement | undefined {
  return (document.querySelector(
    '[data-slot="checkbox"]'
  ) as HTMLElement | null) ?? undefined
}

async function renderDialog(props: {
  open: boolean
  notice: string
  countdownSeconds?: number
  onDismiss: (hideToday: boolean) => void
  onOpenChange: (open: boolean) => void
}) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <AnnouncementDialog
          open={props.open}
          onOpenChange={props.onOpenChange}
          notice={props.notice}
          onDismiss={props.onDismiss}
          countdownSeconds={props.countdownSeconds}
        />
      </I18nextProvider>
    )
  )

  return { container, root }
}

const sampleNotice = '**System maintenance** at 02:00'

describe('AnnouncementDialog component', () => {
  afterAll(() => {
    document.body.innerHTML = ''
  })

  test('renders the notice, hide-today checkbox and the confirm action when open', async () => {
    const { root } = await renderDialog({
      open: true,
      notice: sampleNotice,
      countdownSeconds: 0,
      onDismiss: () => undefined,
      onOpenChange: () => undefined,
    })

    expect(
      document.body.textContent?.includes('System maintenance')
    ).toBe(true)
    expect(findCheckbox()).toBeTruthy()
    expect(findFooterButton('Got it')).toBeTruthy()

    await act(async () => root.unmount())
  })

  test('does not render the dialog body when closed', async () => {
    const { root } = await renderDialog({
      open: false,
      notice: sampleNotice,
      countdownSeconds: 0,
      onDismiss: () => undefined,
      onOpenChange: () => undefined,
    })

    expect(
      document.body.textContent?.includes('System maintenance')
    ).toBe(false)

    await act(async () => root.unmount())
  })

  test('the confirm action is disabled with remaining seconds during countdown', async () => {
    const { root } = await renderDialog({
      open: true,
      notice: sampleNotice,
      countdownSeconds: 5,
      onDismiss: () => undefined,
      onOpenChange: () => undefined,
    })

    const gotItButton = findFooterButton('Got it (5s)')
    expect(gotItButton).toBeTruthy()
    expect(gotItButton?.disabled).toBe(true)

    await act(async () => root.unmount())
  })

  test('confirm fires onDismiss(true) when hide-today is checked by default', async () => {
    const dismissCalls: boolean[] = []
    const { root } = await renderDialog({
      open: true,
      notice: 'Hello',
      countdownSeconds: 0,
      onDismiss: (hideToday) => dismissCalls.push(hideToday),
      onOpenChange: () => undefined,
    })

    const gotItButton = findFooterButton('Got it')
    expect(gotItButton).toBeTruthy()
    await act(async () => gotItButton?.click())
    expect(dismissCalls).toEqual([true])

    await act(async () => root.unmount())
  })

  test('confirm fires onDismiss(false) after unchecking hide-today', async () => {
    const dismissCalls: boolean[] = []
    const { root } = await renderDialog({
      open: true,
      notice: 'Hello',
      countdownSeconds: 0,
      onDismiss: (hideToday) => dismissCalls.push(hideToday),
      onOpenChange: () => undefined,
    })

    const checkbox = findCheckbox()
    expect(checkbox).toBeTruthy()
    await act(async () => checkbox?.click())

    const gotItButton = findFooterButton('Got it')
    expect(gotItButton).toBeTruthy()
    await act(async () => gotItButton?.click())
    expect(dismissCalls).toEqual([false])

    await act(async () => root.unmount())
  })
})
