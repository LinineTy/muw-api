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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { AdminSubscriptionsTable } from './components/admin-subscriptions-table'
import { SubscriptionsDialogs } from './components/subscriptions-dialogs'
import { SubscriptionsPrimaryButtons } from './components/subscriptions-primary-buttons'
import { SubscriptionsProvider } from './components/subscriptions-provider'
import { SubscriptionsTable } from './components/subscriptions-table'

function SubscriptionsContent() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'plans' | 'all'>('plans')

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Subscription Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <SubscriptionsPrimaryButtons />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-4'>
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as 'plans' | 'all')}
              className='flex min-h-0 flex-1 flex-col'
            >
              <TabsList className='w-fit'>
                <TabsTrigger value='plans'>{t('Plans')}</TabsTrigger>
                <TabsTrigger value='all'>
                  {t('All Subscriptions')}
                </TabsTrigger>
              </TabsList>
              <div className='min-h-0 flex-1 pt-2'>
                {tab === 'plans' ? (
                  <SubscriptionsTable />
                ) : (
                  <AdminSubscriptionsTable />
                )}
              </div>
            </Tabs>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <SubscriptionsDialogs />
    </>
  )
}

export function Subscriptions() {
  return (
    <SubscriptionsProvider>
      <SubscriptionsContent />
    </SubscriptionsProvider>
  )
}
