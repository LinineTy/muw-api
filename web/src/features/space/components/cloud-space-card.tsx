// @muw-owned
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TitledCard } from '@/components/ui/titled-card'

import type { SpaceInfo } from '../types'
import { SpaceConversationsSection } from './space-conversations-section'
import { SpacePermanentSection } from './space-permanent-section'
import { SpaceTransientSection } from './space-transient-section'

type CloudSpaceCardProps = {
  space: SpaceInfo | null
  onChanged: () => void
}

/**
 * 云空间：永久图 / 临时图 / 对话三个页签。容量与购买在右侧的容量卡里。
 */
export function CloudSpaceCard(props: CloudSpaceCardProps) {
  const { t } = useTranslation()

  return (
    <TitledCard
      title={t('Cloud Space')}
      description={t('Manage your cloud storage and synced conversations.')}
      disableHoverEffect
    >
      <Tabs defaultValue='permanent' className='flex flex-col gap-4'>
        <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
          <TabsTrigger value='permanent'>{t('Permanent images')}</TabsTrigger>
          <TabsTrigger value='transient'>{t('Temporary images')}</TabsTrigger>
          <TabsTrigger value='conversations'>{t('Conversations')}</TabsTrigger>
        </TabsList>

        <TabsContent value='permanent'>
          <SpacePermanentSection />
        </TabsContent>
        <TabsContent value='transient'>
          <SpaceTransientSection
            space={props.space}
            onCleared={props.onChanged}
          />
        </TabsContent>
        <TabsContent value='conversations'>
          <SpaceConversationsSection
            space={props.space}
            onChanged={props.onChanged}
          />
        </TabsContent>
      </Tabs>
    </TitledCard>
  )
}
