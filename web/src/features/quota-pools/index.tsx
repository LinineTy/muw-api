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

import { QuotaPoolsDialogs } from './components/quota-pools-dialogs'
import { QuotaPoolsPrimaryButtons } from './components/quota-pools-primary-buttons'
import { QuotaPoolsProvider } from './components/quota-pools-provider'
import { QuotaPoolsTable } from './components/quota-pools-table'

export function QuotaPools() {
  const { t } = useTranslation()
  return (
    <QuotaPoolsProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Quota Pools')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <QuotaPoolsPrimaryButtons />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <QuotaPoolsTable />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <QuotaPoolsDialogs />
    </QuotaPoolsProvider>
  )
}
