// @muw-owned
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { IpAnalysis } from '@/features/ip-analysis'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const ipAnalysisSearchSchema = z.object({
  tab: z.enum(['users', 'ips']).optional().catch('users'),
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(undefined),
  min_ips: z.string().optional().catch(''),
  min_users: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/ip-analysis/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    if (auth.user?.role !== ROLE.SUPER_ADMIN) {
      throw redirect({
        to: '/403',
      })
    }
  },
  validateSearch: ipAnalysisSearchSchema,
  component: IpAnalysis,
})
