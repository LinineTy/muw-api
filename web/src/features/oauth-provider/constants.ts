// @muw-owned
import type { StatusVariant } from '@/components/status-badge'

// 应用状态：文案存 i18n key（英文原文），渲染时经 t() 取译文。
export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  disabled: 'Disabled',
}

export const APPLICATION_STATUS_VARIANTS: Record<string, StatusVariant> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  disabled: 'neutral',
}

// 审核队列的状态筛选项（值即后端 status 参数）。
export const APPLICATION_STATUS_FILTER = [
  'pending',
  'approved',
  'rejected',
  'disabled',
] as const

// 站内 OIDC 的查询缓存前缀：任一变更后统一失效，统计与各列表一起刷新。
export const OAUTH_QUERY_KEY = ['oauth'] as const
