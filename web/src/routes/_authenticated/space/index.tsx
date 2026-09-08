// @muw-owned
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Space } from '@/features/space'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'

export const Route = createFileRoute('/_authenticated/space/')({
  beforeLoad: () => {
    if (!isSidebarModuleEnabled('personal', 'space')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: SpacePage,
})

function SpacePage() {
  return <Space />
}
