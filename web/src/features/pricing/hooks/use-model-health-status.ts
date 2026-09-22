// @muw-owned
import { useQuery } from '@tanstack/react-query'

import { getModelHealth } from '@/features/model-health/api'
import { useAuthStore } from '@/stores/auth-store'

/**
 * 模型广场卡片状态点的数据源。
 *
 * 复用模型健康页的聚合接口(/api/channel/health/models, 24h 窗口):
 * - 已登录 → 拉取并按 model_name 建成功率 map(非管理员拿到的行已抹掉渠道名/延迟,
 *   同模型多渠道时取成功率最高的那条)
 * - 未登录 → 不发起请求,卡片不渲染状态点(pricing 页可公开)
 * - 请求失败(无权限/网络) → 静默降级,等同未登录
 */
export function useModelHealthStatus() {
  const isLoggedIn = Boolean(useAuthStore((s) => s.auth.user))

  return useQuery({
    queryKey: ['pricing-model-health', 1],
    queryFn: async () => {
      const res = await getModelHealth({ days: 1 })
      const map = new Map<string, number>()
      for (const row of res.data ?? []) {
        // 同一模型多行(管理员视角按渠道拆行)取最优成功率——状态点语义是
        // "这个模型能不能用",只要有任一可用渠道就不该标红。
        const prev = map.get(row.model_name)
        if (prev === undefined || row.success_rate > prev) {
          map.set(row.model_name, row.success_rate)
        }
      }
      return map
    },
    enabled: isLoggedIn,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
