// @muw-owned
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Activate } from '@/features/auth/activate'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/activate')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    if (!auth.user) {
      throw redirect({ to: '/sign-in' })
    }
    // 已激活账号不应停留在激活页。
    if (auth.user.activated !== false) {
      throw redirect({ to: '/os-desktop', replace: true })
    }
  },
  component: Activate,
})
