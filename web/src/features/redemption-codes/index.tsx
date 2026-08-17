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

import { RedemptionsDialogs } from './components/redemptions-dialogs'
import { RedemptionsPrimaryButtons } from './components/redemptions-primary-buttons'
import { RedemptionsProvider } from './components/redemptions-provider'
import { RedemptionsTable } from './components/redemptions-table'

export function Redemptions() {
  const { t } = useTranslation()
  // 批量模式开关：放页面头部（与渠道一致），表格按它开关勾选列/批量栏。
  const [batchMode, setBatchMode] = useState(false)
  return (
    <RedemptionsProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Redemption Codes')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <RedemptionsPrimaryButtons
            batchMode={batchMode}
            onBatchModeChange={setBatchMode}
          />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <RedemptionsTable batchMode={batchMode} />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <RedemptionsDialogs />
    </RedemptionsProvider>
  )
}
