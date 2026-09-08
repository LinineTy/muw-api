// @muw-owned
import { nanoid } from 'nanoid'

import { STORAGE_KEYS } from '../../constants'
import type { SystemPreset } from '../../types'
import { systemPresetsSchema } from './storage-schema'
import { userScopedKey } from './storage'

/**
 * Load saved system-prompt presets from localStorage.
 */
export function loadSystemPresets(): SystemPreset[] {
  try {
    const saved = localStorage.getItem(
      userScopedKey(STORAGE_KEYS.SYSTEM_PRESETS)
    )
    if (!saved) return []
    const parsed = JSON.parse(saved) as unknown
    return systemPresetsSchema.parse(parsed)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load system presets:', error)
  }
  return []
}

/**
 * Save a new preset (deduplicated by name), returns the updated list.
 */
export function saveSystemPreset(
  presets: SystemPreset[],
  name: string,
  content: string
): SystemPreset[] {
  const trimmedName = name.trim()
  const next = presets.filter((preset) => preset.name !== trimmedName)
  const updated: SystemPreset[] = [
    { id: nanoid(), name: trimmedName, content },
    ...next,
  ]
  persistSystemPresets(updated)
  return updated
}

/**
 * Delete a preset by id, returns the updated list.
 */
export function deleteSystemPreset(
  presets: SystemPreset[],
  id: string
): SystemPreset[] {
  const updated = presets.filter((preset) => preset.id !== id)
  persistSystemPresets(updated)
  return updated
}

function persistSystemPresets(presets: SystemPreset[]): void {
  try {
    localStorage.setItem(
      userScopedKey(STORAGE_KEYS.SYSTEM_PRESETS),
      JSON.stringify(presets)
    )
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save system presets:', error)
  }
}
