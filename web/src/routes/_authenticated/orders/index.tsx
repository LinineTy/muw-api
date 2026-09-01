// @muw-owned
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
