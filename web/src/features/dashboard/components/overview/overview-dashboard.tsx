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
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useStatus } from '@/hooks/use-status'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useDashboardContentVisibility } from '../../hooks/use-status-data'
import { useSystemLoad } from '../../hooks/use-system-load'
import { AnnouncementsPanel } from './announcements-panel'
import { ApiInfoPanel } from './api-info-panel'
import { FAQPanel } from './faq-panel'
import { PerformanceHealthPanel } from './performance-health-panel'
import { SummaryCards } from './summary-cards'
import { SystemLoadIndicator } from './system-load-indicator'
import { UptimePanel } from './uptime-panel'

export function OverviewDashboard() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const { status } = useStatus()
  const {
    apiInfo: showApiInfoPanel,
    announcements: showAnnouncementsPanel,
    faq: showFAQPanel,
    uptimeKuma: showUptimePanel,
    systemLoad: showSystemLoad,
  } = useDashboardContentVisibility()
  const { load } = useSystemLoad(showSystemLoad)

  const isAdmin = Boolean(user?.role && user.role >= ROLE.ADMIN)
  const showLeftContentPanels =
    isAdmin || showApiInfoPanel || showAnnouncementsPanel || showFAQPanel
  const showContentPanels = showLeftContentPanels || showUptimePanel

  // 视觉兜底开启时提示用户：发图给不支持视觉的模型会被自动描述，
  // 可能产生额外扣费（普通用户只能从公开的 /api/status 拿到该开关）。
  const visionFallbackEnabled = status?.visual_fallback_enabled === true
  const visionFallbackHint = t(
    'Images sent to models without vision support are automatically described by a vision model, which may incur extra charges. This applies only to the OpenAI chat interface (/v1/chat/completions); Claude Messages and Responses requests are not affected.'
  )

  return (
    <div className='flex flex-col gap-4'>
      {showSystemLoad && load && visionFallbackEnabled && (
        // 桌面端单行：负载 1/3 + 提示 2/3；移动端上下两行（负载在上）
        <div className='flex flex-col gap-3 lg:flex-row'>
          <div className='flex items-center rounded-lg border px-4 py-3 lg:w-1/3'>
            <SystemLoadIndicator load={load} />
          </div>
          <div className='flex items-center gap-2 rounded-lg border px-4 py-3 lg:w-2/3'>
            <Info className='h-4 w-4 shrink-0' />
            <div className='min-w-0'>
              <p className='text-sm font-medium'>
                {t('Image vision assistance enabled')}
              </p>
              <p className='text-muted-foreground text-sm'>
                {visionFallbackHint}
              </p>
            </div>
          </div>
        </div>
      )}
      {visionFallbackEnabled && (!showSystemLoad || !load) && (
        <Alert>
          <Info />
          <AlertTitle>{t('Image vision assistance enabled')}</AlertTitle>
          <AlertDescription>{visionFallbackHint}</AlertDescription>
        </Alert>
      )}
      {!visionFallbackEnabled && showSystemLoad && load && (
        <div className='flex items-center rounded-lg border px-4 py-3'>
          <SystemLoadIndicator load={load} />
        </div>
      )}

      <SummaryCards />

      {showContentPanels && (
        <CardStaggerContainer
          className={cn(
            'grid grid-cols-1 gap-4',
            showLeftContentPanels &&
              showUptimePanel &&
              'xl:grid-cols-[minmax(0,1fr)_22rem]'
          )}
        >
          {showLeftContentPanels && (
            <div
              className={cn(
                'grid min-w-0 grid-cols-1 gap-4',
                (showApiInfoPanel || showAnnouncementsPanel || showFAQPanel) &&
                  'lg:grid-cols-2'
              )}
            >
              {isAdmin && (
                <CardStaggerItem className='lg:col-span-2'>
                  <PerformanceHealthPanel />
                </CardStaggerItem>
              )}
              {showApiInfoPanel && (
                <CardStaggerItem>
                  <ApiInfoPanel />
                </CardStaggerItem>
              )}
              {showAnnouncementsPanel && (
                <CardStaggerItem>
                  <AnnouncementsPanel />
                </CardStaggerItem>
              )}
              {showFAQPanel && (
                <CardStaggerItem>
                  <FAQPanel />
                </CardStaggerItem>
              )}
            </div>
          )}
          {showUptimePanel && (
            <CardStaggerItem>
              <UptimePanel />
            </CardStaggerItem>
          )}
        </CardStaggerContainer>
      )}
    </div>
  )
}
