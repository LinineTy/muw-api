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
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { Orders, type OrderTab } from '@/features/orders'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'

const ordersSearchSchema = z.object({
  // 枚举校验 + catch：?tab=xxx 落回订阅 tab，不出现"无匹配内容"空白页。
  tab: z.enum(['subscription', 'billing', 'space']).catch('subscription'),
})

export const Route = createFileRoute('/_authenticated/orders/')({
  beforeLoad: () => {
    if (!isSidebarModuleEnabled('personal', 'orders')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: OrdersPage,
  validateSearch: ordersSearchSchema,
})

function OrdersPage() {
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  // tab 与 URL 同步：切换/回退/手改 URL 都生效，不只在挂载时读一次。
  const handleTabChange = (value: OrderTab) => {
    navigate({ search: (prev) => ({ ...prev, tab: value }) })
  }
  return <Orders tab={tab} onTabChange={handleTabChange} />
}
