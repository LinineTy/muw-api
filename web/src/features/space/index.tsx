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
import { useCallback, useEffect, useState } from 'react'

import { SpaceConversationsSection } from './components/space-conversations-section'
import { SpaceHeader } from './components/space-header'
import { SpacePermanentSection } from './components/space-permanent-section'
import { SpaceTransientSection } from './components/space-transient-section'
import { getSpaceInfo } from './api'
import type { SpaceInfo } from './types'

/**
 * 用户云空间：独立页面，分区展示永久图 / 临时图 / 同步对话 + 用量与购买。
 * 与图床（管理员公开图床）完全独立。
 */
export function Space() {
  const [space, setSpace] = useState<SpaceInfo | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    setSpace(await getSpaceInfo())
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])

  return (
    <div className='mx-auto max-w-5xl space-y-6 p-4 md:p-6'>
      <SpaceHeader onPurchased={refresh} space={space} />
      <SpacePermanentSection />
      <SpaceTransientSection onCleared={refresh} space={space} />
      <SpaceConversationsSection />
    </div>
  )
}
