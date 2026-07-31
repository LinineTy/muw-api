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
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'

import { BillingPreferenceSelect } from './components/billing-preference-select'
import { MySubscriptionsProvider } from './components/my-subscriptions-provider'
import { MySubscriptionsTabs } from './components/my-subscriptions-tabs'

function MySubscriptionsContent() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('My Subscriptions')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <BillingPreferenceSelect />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <MySubscriptionsTabs />
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
