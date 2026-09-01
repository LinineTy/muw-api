// @muw-owned
import { createFileRoute } from '@tanstack/react-router'

import { ModelHealth } from '@/features/model-health'

export const Route = createFileRoute('/_authenticated/model-health/')({
  component: ModelHealth,
})
