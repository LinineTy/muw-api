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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

import { SpaceConversationsSection } from './components/space-conversations-section'
import { SpaceHeader } from './components/space-header'
import { SpacePermanentSection } from './components/space-permanent-section'
import { SpaceTransientSection } from './components/space-transient-section'
import { getSpaceInfo } from './api'
import type { SpaceInfo } from './types'

/**
 * 用户云空间：独立页面。顶部为紧凑用量条，下方用 tab 切换永久图/临时图/对话，
 * 内容多了不至于纵向堆叠放不下。与图床（管理员公开图床）完全独立。
 */
export function Space() {
  const { t } = useTranslation()
  const [space, setSpace] = useState<SpaceInfo | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    try {
      setSpace(await getSpaceInfo())
    } catch {
      // 网络异常等未预期失败：明确提示而不是让页面用量条永远显示 '—'。
      toast.error(t('Failed to load cloud space'))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Cloud Space')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
          <SpaceHeader onPurchased={refresh} space={space} />

          <Tabs defaultValue='permanent'>
            <TabsList>
              <TabsTrigger value='permanent'>
                {t('Permanent images')}
              </TabsTrigger>
              <TabsTrigger value='transient'>
                {t('Temporary images')}
              </TabsTrigger>
              <TabsTrigger value='conversations'>
                {t('Conversations')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value='permanent'>
              <SpacePermanentSection />
            </TabsContent>
            <TabsContent value='transient'>
              <SpaceTransientSection onCleared={refresh} space={space} />
            </TabsContent>
            <TabsContent value='conversations'>
              <SpaceConversationsSection
                space={space}
                onChanged={refresh}
              />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
