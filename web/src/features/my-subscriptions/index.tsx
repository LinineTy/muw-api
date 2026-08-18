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
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'

import { BillingPreferenceSelect } from './components/billing-preference-select'
import { MySubscriptionsProvider } from './components/my-subscriptions-provider'
import {
  MySubscriptionsTabs,
  type MySubscriptionsTab,
} from './components/my-subscriptions-tabs'

function MySubscriptionsContent() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<MySubscriptionsTab>('active')

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('My Subscriptions')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          onClick={() => setTab('plans')}
          className='bg-linear-to-r from-primary to-primary/80 text-primary-foreground shadow-sm'
        >
          <Sparkles className='size-4' />
          {t('Buy subscription plan')}
        </Button>
        <BillingPreferenceSelect />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <MySubscriptionsTabs tab={tab} onTabChange={setTab} />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

export function MySubscriptions() {
  return (
    <MySubscriptionsProvider>
      <MySubscriptionsContent />
    </MySubscriptionsProvider>
  )
}
