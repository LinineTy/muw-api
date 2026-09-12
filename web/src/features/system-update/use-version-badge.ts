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

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/** 角标状态：绿 = 已是最新，黄 = 有新版本，灰（unknown）= 检查失败/未启用。 */
export type VersionBadgeState = 'latest' | 'update' | 'unknown'

export type ForkUpdateCheckData = {
  has_update: boolean
  latest_tag: string
  current_version: string
  latest_changelog?: string
}

/**
 * fork 自研：版本角标。
 *
 * 上游的版本呈现是「品牌名旁常驻版本号文本 + 去 GitHub 查 release」，本 fork 改成
 * 「logo 右下角一个小球」：绿 = 已是最新、黄 = 有新版本、灰 = 检查失败或未知。
 *
 * 数据源是本仓库自己的 `/api/status/update-check`（后端读 registry.dev3 的 tags
 * 列表并与 `common.Version` 比较，再从公共 CHANGELOG 取新版本说明）——不再问
 * GitHub，因为我们的版本号（`vYY.MM.DD.muw.N`）与上游 tag 体系无关。
 *
 * 该接口需要管理员权限，故非管理员返回 `unknown`（不渲染小球）。
 */
export function useVersionBadge(options: { enabled?: boolean } = {}) {
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = (user?.role ?? 0) >= ROLE.ADMIN
  const enabled = (options.enabled ?? true) && isAdmin

  const query = useQuery({
    queryKey: ['version-badge', 'update-check'],
    enabled,
    retry: false,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: ForkUpdateCheckData }>(
        '/api/status/update-check'
      )
      return res.data?.data
    },
  })

  const state: VersionBadgeState = !enabled
    ? 'unknown'
    : query.isSuccess && query.data
      ? query.data.has_update
        ? 'update'
        : 'latest'
      : 'unknown'

  return {
    state,
    data: query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
  }
}
