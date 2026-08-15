/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { RiskControlPage } from '@/features/risk-control'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const riskControlSearchSchema = z.object({
  tab: z
    .enum(['users', 'logs', 'conversations', 'markers'])
    .optional()
    .catch('users'),
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(undefined),
  // 低分用户：分数上限
  threshold: z.string().optional().catch(''),
  // 扣分明细：用户 ID + 来源
  user_id: z.string().optional().catch(''),
  source: z.array(z.string()).optional().catch([]),
  // 对话记录：request_id + 模型 + 用户 ID
  request_id: z.string().optional().catch(''),
  model_name: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/risk-control/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    if (auth.user?.role !== ROLE.SUPER_ADMIN) {
      throw redirect({
        to: '/403',
      })
    }
  },
  validateSearch: riskControlSearchSchema,
  component: RiskControlPage,
})
