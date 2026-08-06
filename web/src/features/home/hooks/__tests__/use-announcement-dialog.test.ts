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
import { beforeEach, describe, test } from 'node:test'

import {
  closeNoticeForToday,
  hashNotice,
  isNoticeClosedToday,
  shouldShowNoticePopup,
} from '../use-announcement-dialog'

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createLocalStorageMock(),
  })
})

describe('announcement popup dismissal', () => {
  test('isNoticeClosedToday is false before the notice is dismissed', () => {
    assert.equal(isNoticeClosedToday(), false)
  })

  test('closeNoticeForToday persists the current date and hash', () => {
    closeNoticeForToday('**maintenance**')

    assert.equal(
      localStorage.getItem('notice_close_date'),
      new Date().toDateString()
    )
    assert.equal(
      localStorage.getItem('notice_close_hash'),
      hashNotice('**maintenance**')
    )
  })

  test('a stale notice_close_date from a previous day does not count as today', () => {
    localStorage.setItem('notice_close_date', 'Mon Jan 01 2001')

    assert.equal(isNoticeClosedToday(), false)
    assert.equal(shouldShowNoticePopup('anything'), true)
  })

  test('does not show again for the same content dismissed today', () => {
    closeNoticeForToday('hello')
    assert.equal(shouldShowNoticePopup('hello'), false)
  })

  test('shows again when the notice text changed since dismissal', () => {
    closeNoticeForToday('hello')
    assert.equal(shouldShowNoticePopup('**updated** content'), true)
  })

  test('shows when nothing was dismissed before', () => {
    assert.equal(shouldShowNoticePopup('hello'), true)
  })

  test('hashNotice is stable and changes with content', () => {
    assert.equal(hashNotice('abc'), hashNotice('abc'))
    assert.notEqual(hashNotice('abc'), hashNotice('abd'))
  })
})
