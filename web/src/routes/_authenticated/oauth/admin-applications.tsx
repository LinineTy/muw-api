// @muw-owned
import { createFileRoute, redirect } from '@tanstack/react-router'

import { OAuthAdminApplicationsPage } from '@/features/oauth-provider/admin-applications-page'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

// 管理员审核页：审核第三方应用申请、启停与删除。非管理员一律拦到 403。
export const Route = createFileRoute('/_authenticated/oauth/admin-applications')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if ((auth.user?.role ?? 0) < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
  },
  component: OAuthAdminApplicationsPage,
})
