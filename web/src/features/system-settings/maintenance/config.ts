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
import type { HeaderNavCustomLink } from '@/lib/nav-modules'

export type HeaderNavAccessConfig = {
  enabled: boolean
  requireAuth: boolean
}

export type HeaderNavModulesConfig = {
  home: boolean
  console: boolean
  pricing: HeaderNavAccessConfig
  rankings: HeaderNavAccessConfig
  docs: boolean
  about: boolean
  customLinks: HeaderNavCustomLink[]
  [key: string]: boolean | HeaderNavAccessConfig | HeaderNavCustomLink[]
}

export type SidebarSectionConfig = {
  enabled: boolean
  [key: string]: boolean
}

export type SidebarModulesAdminConfig = Record<string, SidebarSectionConfig>

export const HEADER_NAV_DEFAULT: HeaderNavModulesConfig = {
  home: true,
  console: true,
  pricing: {
    enabled: true,
    requireAuth: false,
  },
  rankings: {
    enabled: true,
    requireAuth: false,
  },
  docs: true,
  about: true,
  customLinks: [],
}

export const SIDEBAR_MODULES_DEFAULT: SidebarModulesAdminConfig = {
  chat: {
    enabled: true,
    playground: true,
    chat: true,
  },
  console: {
    enabled: true,
    detail: true,
    token: true,
    log: true,
    midjourney: true,
    task: true,
    model_health: true,
  },
  personal: {
    enabled: true,
    topup: true,
    personal: true,
    my_subscriptions: true,
    space: true,
    orders: true,
  },
  admin: {
    enabled: true,
    channel: true,
    models: true,
    user: true,
    redemption: true,
    subscription: true,
    system_info: true,
    setting: true,
  },
  addon: {
    enabled: true,
    image_host: true,
  },
}

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return fallback
}

const cloneHeaderNavDefault = (): HeaderNavModulesConfig => ({
  ...HEADER_NAV_DEFAULT,
  pricing: { ...HEADER_NAV_DEFAULT.pricing },
  rankings: { ...HEADER_NAV_DEFAULT.rankings },
  customLinks: HEADER_NAV_DEFAULT.customLinks.map((link) => ({ ...link })),
})

const parseAccessModule = (
  raw: unknown,
  fallback: HeaderNavAccessConfig
): HeaderNavAccessConfig => {
  if (
    typeof raw === 'boolean' ||
    typeof raw === 'string' ||
    typeof raw === 'number'
  ) {
    return {
      enabled: toBoolean(raw, fallback.enabled),
      requireAuth: fallback.requireAuth,
    }
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    return {
      enabled: toBoolean(record.enabled, fallback.enabled),
      requireAuth: toBoolean(record.requireAuth, fallback.requireAuth),
    }
  }
  return { ...fallback }
}

const cloneSidebarDefault = (): SidebarModulesAdminConfig =>
  Object.entries(SIDEBAR_MODULES_DEFAULT).reduce<SidebarModulesAdminConfig>(
    (acc, [section, config]) => {
      acc[section] = { ...config }
      return acc
    },
    {}
  )

export function parseHeaderNavModules(
  value: string | null | undefined
): HeaderNavModulesConfig {
  const base = cloneHeaderNavDefault()
  if (!value) {
    return base
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const result: HeaderNavModulesConfig = {
      ...base,
      pricing: { ...base.pricing },
      rankings: { ...base.rankings },
    }

    Object.entries(parsed).forEach(([key, raw]) => {
      if (key === 'pricing') {
        result.pricing = parseAccessModule(raw, base.pricing)
        return
      }
      if (key === 'rankings') {
        result.rankings = parseAccessModule(raw, base.rankings)
        return
      }
      if (key === 'customLinks') {
        result.customLinks = parseHeaderNavCustomLinks(raw)
        return
      }

      if (typeof raw === 'boolean') {
        result[key] = raw
        return
      }
      if (typeof raw === 'string' || typeof raw === 'number') {
        result[key] = toBoolean(raw, Boolean(base[key]))
        return
      }
    })

    return result
  } catch {
    return base
  }
}

const parseHeaderNavCustomLinks = (raw: unknown): HeaderNavCustomLink[] => {
  if (!Array.isArray(raw)) return []
  const links: HeaderNavCustomLink[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const href = typeof record.href === 'string' ? record.href.trim() : ''
    if (!title || !href) continue
    links.push({
      title,
      href,
      enabled: toBoolean(record.enabled, true),
    })
  }
  return links
}

export function serializeHeaderNavModules(
  config: HeaderNavModulesConfig
): string {
  return JSON.stringify(config)
}

export function parseSidebarModulesAdmin(
  value: string | null | undefined
): SidebarModulesAdminConfig {
  const defaults = cloneSidebarDefault()
  // If empty string, null, or undefined, use default config
  if (!value || value.trim() === '') return defaults

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const result: SidebarModulesAdminConfig = {}

    // 以 defaults 的键序为准重建每个 section:开关顺序固定,不随后端存量 JSON 的
    // 键序漂移——否则新增模块(如 coding_plan)会被追加到末尾,设置里显得很乱。
    Object.entries(defaults).forEach(([sectionKey, defaultSection]) => {
      const rawSection = parsed[sectionKey]
      const raw =
        rawSection && typeof rawSection === 'object'
          ? (rawSection as Record<string, unknown>)
          : {}
      const sectionConfig: SidebarSectionConfig = {
        enabled: toBoolean(raw.enabled, defaultSection.enabled ?? true),
      }

      Object.entries(defaultSection).forEach(([moduleKey, defaultValue]) => {
        if (moduleKey === 'enabled') return
        sectionConfig[moduleKey] =
          moduleKey in raw
            ? toBoolean(raw[moduleKey], defaultValue)
            : defaultValue
      })

      result[sectionKey] = sectionConfig
    })

    // 注意:不要从此处"前向兼容"地把 defaults 里没有的 section/module 捞回来。
    // 存量 JSON 可能带着旧版本残留的模块(如 model_health 迁到 console 之前,
    // admin 区仍存有 admin.model_health)——捞回来会在设置表单里出现删不掉的
    // 残留开关。新模块上线时 defaults 必然同步更新,这里严格以 defaults 为准即可。
    return result
  } catch {
    return defaults
  }
}

export function serializeSidebarModulesAdmin(
  config: SidebarModulesAdminConfig
): string {
  return JSON.stringify(config)
}
