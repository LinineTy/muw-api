// @muw-owned
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { LoginResult } from '@/features/auth/login-result'

const searchSchema = z.object({
  status: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/login-result')({
  component: LoginResult,
  validateSearch: searchSchema,
})
