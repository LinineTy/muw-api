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
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Bun defaults NODE_ENV to `production` when it runs a script, and Vite only
// fills NODE_ENV in when it is unset. That makes Vitest resolve React to its
// production build, which intentionally drops `act`; every @testing-library
// render then dies with "React.act is not a function". Pin it to `test` before
// the config (and therefore the module graph) is resolved.
if (process.env.NODE_ENV !== 'test') {
  process.env.NODE_ENV = 'test'
}

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Belt and braces: keep workers on `test` too, so a caller that exports
    // NODE_ENV=production cannot resurrect the production React build.
    env: { NODE_ENV: 'test' },
    environment: 'jsdom',
    // 全量跑时默认并发会把容器 CPU 抢满，导致大量 5s 超时的**假失败**
    // （单文件跑同一批用例全绿）。限制 worker 数并放宽单测超时，让全量结果可信。
    maxWorkers: 4,
    testTimeout: 20000,
    server: {
      deps: { inline: [/@lobehub\//, /antd-style/] },
    },
    setupFiles: ['./src/test-setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'scripts/oxlint/__tests__/*.test.ts',
    ],
  },
})
