/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
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
