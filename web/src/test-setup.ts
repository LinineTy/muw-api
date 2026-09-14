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
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll } from 'vitest'

import { api } from '@/lib/api'

// waitFor / findBy* 的默认超时是 1s。全量跑时 4 个 worker 会把 CPU 抢满，动作链
//（点提交 → zod 异步校验 → RHF handleSubmit → mutation → POST）实测会明显变慢。
// 与 vitest.config.ts 把 testTimeout 提到 20s 同一个理由，统一把异步工具超时放宽到 5s。
// 注意：channel-bound-accounts 长期被记成 "flaky" 的真因不是这个超时，而是下面那段
// 「未 mock 的请求真的出网 → 401 → 会话刷新失败 → 登出」，见下方注释。
configure({ asyncUtilTimeout: 5000 })

// 用例没 mock 的请求一律不许真的出网。jsdom 的默认 origin 是 http://localhost:3000，
// 而本机（容器/开发机）常常就有一个 dev 服务在跑：漏 mock 的 POST/PUT 会真的打到它并
// 拿到 401 → 触发 http-client 的「刷新会话 → 失败即登出」链路，把用例 beforeEach 里
// 设好的登录态清掉（表现=提交按钮变 disabled、断言超时，且随负载时快时慢）。
// 这里统一让未 mock 的请求以网络错误失败：既不开这个口子，也不再依赖"本机是否恰好有服务在听"。
api.defaults.adapter = async (config) => {
  throw Object.assign(new Error('Network disabled in tests'), {
    config,
    isAxiosError: true,
    code: 'ERR_NETWORK',
  })
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {},
      },
    },
  })
})

afterEach(() => {
  cleanup()
})

// Prefer reduced motion in tests: entrance animations write inline
// `opacity: 0` on their first frame, and jsdom advances frames through a
// setTimeout-based rAF shim, so jest-dom visibility assertions would race the
// animation. The reduced-motion code paths render the same DOM without
// transient hidden states. Both `(prefers-reduced-motion: reduce)` and the
// boolean `(prefers-reduced-motion)` form match; `no-preference` does not.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches:
      query.includes('prefers-reduced-motion') &&
      !query.includes('no-preference'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

// jsdom does not implement Range geometry. CodeMirror measures text through
// these browser APIs; actual wrapping and scrolling are checked in browser QA.
if (!Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => [],
  })
}
if (!Range.prototype.getBoundingClientRect) {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: () => new DOMRect(),
  })
}

window.requestAnimationFrame = (callback: FrameRequestCallback) =>
  window.setTimeout(() => callback(performance.now()), 0)
window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => undefined,
})

// Node.js 25+ defines `localStorage`/`sessionStorage` accessors on the global
// object that resolve to `undefined` unless `--localstorage-file` is set, and
// vitest's jsdom environment does not replace globals that already exist.
// Provide an in-memory Storage so tests see the same API as in a browser.
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name]?.setItem === 'function') continue
  const entries = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(String(key)) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(String(key))
    },
    setItem: (key, value) => {
      entries.set(String(key), String(value))
    },
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: storage,
  })
}
