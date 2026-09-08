// @muw-owned
import { useQuery } from '@tanstack/react-query'

import { getStatus } from '@/lib/api'

export interface SystemLoad {
  cpu_usage?: number
  memory_usage?: number
}

// 从 localStorage 的 /api/status 快照中取负载初值，避免首屏空白。
function getInitialSystemLoad(): SystemLoad | undefined {
  try {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('status')
      if (saved) {
        const parsed = JSON.parse(saved) as { system_load?: SystemLoad }
        return parsed.system_load
      }
    }
  } catch {
    /* empty */
  }
  return undefined
}

// 独立的负载轮询 hook：使用独立 queryKey 与无副作用的 getStatus()，
// 避免给共享 useStatus 加轮询（其 queryFn 每次会写 localStorage 并同步配置 store）。
// enabled 为 false（管理员在设置中关闭概览负载）时停止请求。
export function useSystemLoad(enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ['status', 'system_load'],
    queryFn: async () => {
      const status = await getStatus()
      return (status?.system_load as SystemLoad | undefined) ?? null
    },
    enabled,
    placeholderData: enabled ? (getInitialSystemLoad() ?? null) : null,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  return {
    load: data,
    loading: isLoading,
  }
}
