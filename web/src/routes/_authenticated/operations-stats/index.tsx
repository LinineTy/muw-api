// @muw-owned
import { createFileRoute, redirect } from '@tanstack/react-router'

import { OperationsStats } from '@/features/operations-stats'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/operations-stats/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({
        to: '/403',
      })
    }
  },
  component: OperationsStats,
})
