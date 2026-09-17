// @muw-owned
/**
 * 把日期制版本号（`v26.09.18.muw.1`）美化成人看的写法：
 *
 * - `full`（默认）：`2026-09-18 · 第 1 版`
 * - `compact`：`第 1 版`（调用处已经单独显示了日期时用）
 *
 * 非日期制版本号（上游 semver、packaged tag、未知字符串）一律原样返回。
 * 这里只负责"怎么显示"，不参与任何版本比较——比较逻辑在后端
 * `controller/update_check.go` 的 parseForkVersion。
 */

import type { TFunction } from 'i18next'

const DATE_VERSION_RE = /^v(\d{2})\.(\d{2})\.(\d{2})(?:\.muw\.(\d+))?$/

export type VersionLabelParts = {
  /** `YYYY-MM-DD` */
  date: string
  /** 当天第几个版本（muw.N）；没有这一段时为 undefined */
  build?: number
}

export function parseVersionLabel(
  raw?: string | null
): VersionLabelParts | null {
  const value = (raw ?? '').trim()
  const match = DATE_VERSION_RE.exec(value)
  if (!match) return null
  const [, yy, mm, dd, build] = match
  return {
    date: `20${yy}-${mm}-${dd}`,
    build: build === undefined ? undefined : Number(build),
  }
}

export function formatVersionLabel(
  raw: string | null | undefined,
  t: TFunction,
  options: { style?: 'full' | 'compact' } = {}
): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  const parts = parseVersionLabel(value)
  if (!parts) return value
  const build =
    parts.build === undefined ? '' : t('build {{n}}', { n: parts.build })
  if (options.style === 'compact') {
    return build || value
  }
  return build ? `${parts.date} · ${build}` : parts.date
}
