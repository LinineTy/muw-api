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
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'PointerEvent',
  'MutationObserver',
  'ResizeObserver',
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

// Base UI ScrollArea checks running animations; happy-dom does not implement
// Element.getAnimations, so polyfill it as "no animations".
;(domWindow.HTMLElement.prototype as unknown as {
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
  const footer = domWindow.document.querySelector('[data-slot="dialog-footer"]')
  if (!footer) return undefined
  return [...footer.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text)
  ) as HTMLButtonElement | undefined
}

function findCheckbox(): HTMLElement | undefined {
  return (domWindow.document.querySelector(
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
  after(() => {
    domWindow.close()
  })

  test('renders the notice, hide-today checkbox and the confirm action when open', async () => {
    const { root } = await renderDialog({
      open: true,
      notice: sampleNotice,
      countdownSeconds: 0,
      onDismiss: () => undefined,
      onOpenChange: () => undefined,
    })

    assert.equal(
      domWindow.document.body.textContent?.includes('System maintenance'),
      true
    )
    assert.ok(findCheckbox())
    assert.ok(findFooterButton('Got it'))

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

    assert.equal(
      domWindow.document.body.textContent?.includes('System maintenance'),
      false
    )

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
    assert.ok(gotItButton)
    assert.equal(gotItButton.disabled, true)

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
    assert.ok(gotItButton)
    await act(async () => gotItButton.click())
    assert.deepEqual(dismissCalls, [true])

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
    assert.ok(checkbox)
    await act(async () => checkbox.click())

    const gotItButton = findFooterButton('Got it')
    assert.ok(gotItButton)
    await act(async () => gotItButton.click())
    assert.deepEqual(dismissCalls, [false])

    await act(async () => root.unmount())
  })
})
