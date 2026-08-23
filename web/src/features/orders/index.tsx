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
import { Layers } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  MobileToggleMenu,
  ToggleMenuItem,
  TogglePill,
} from '@/components/ui/responsive-toggle'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

import { BillingTab } from './components/billing-tab'
import { SpaceOrdersTab } from './components/space-orders-tab'
import { SubscriptionTab } from './components/subscription-tab'

export type OrderTab = 'subscription' | 'billing' | 'space'

interface OrdersProps {
  // tab 由路由 search 驱动（URL 即数据源），切换时通过 onTabChange 回写 URL。
  tab: OrderTab
  onTabChange: (value: OrderTab) => void
}

/**
 * 订单中心：订阅（套餐购买 + 历史订阅 + 订阅订单）/ 充值记录 / 云空间订单，
 * 分 tab 展示。用户看本人，管理员看全平台。tab 受控于 URL ?tab=（枚举校验，非法值
 * 落回订阅 tab）。
 */
export function Orders({ tab, onTabChange }: OrdersProps) {
  const { t } = useTranslation()
  // 套餐目录「分组显示」开关：状态提升到页面级，按钮放页面头部右上角，仅订阅 tab 可见。
  const [grouped, setGrouped] = useState(true)

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Order Center')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        {tab === 'subscription' && (
          <div className='flex items-center gap-2'>
            <TogglePill
              id='catalog-grouped'
              label={t('Group display')}
              icon={<Layers className='text-muted-foreground h-4 w-4' />}
              checked={grouped}
              onCheckedChange={setGrouped}
            />
            <MobileToggleMenu>
              <ToggleMenuItem
                label={t('Group display')}
                icon={<Layers className='size-4' />}
                checked={grouped}
                onCheckedChange={setGrouped}
              />
            </MobileToggleMenu>
          </div>
        )}
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
          <Tabs
            value={tab}
            onValueChange={(value) => onTabChange(value as OrderTab)}
          >
            <TabsList>
              <TabsTrigger value='subscription'>
                {t('Subscription')}
              </TabsTrigger>
              <TabsTrigger value='billing'>
                {t('Recharge / Subscription')}
              </TabsTrigger>
              <TabsTrigger value='space'>
                {t('Cloud space orders')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value='subscription'>
              <SubscriptionTab grouped={grouped} />
            </TabsContent>
            <TabsContent value='billing'>
              <BillingTab />
            </TabsContent>
            <TabsContent value='space'>
              <SpaceOrdersTab />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
