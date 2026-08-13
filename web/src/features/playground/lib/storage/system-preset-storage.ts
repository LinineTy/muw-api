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
import { nanoid } from 'nanoid'

import { STORAGE_KEYS } from '../../constants'
import type { SystemPreset } from '../../types'
import { systemPresetsSchema } from './storage-schema'

/**
 * Load saved system-prompt presets from localStorage.
 */
export function loadSystemPresets(): SystemPreset[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SYSTEM_PRESETS)
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
    localStorage.setItem(STORAGE_KEYS.SYSTEM_PRESETS, JSON.stringify(presets))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save system presets:', error)
  }
}
