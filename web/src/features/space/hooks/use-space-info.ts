// @muw-owned
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getSpaceInfo } from '../api'
import type { SpaceInfo } from '../types'

/**
 * 云空间用量：容量卡与三个分区共用同一份数据（个人资料页里分列左右两栏）。
 * 购买/清理后调 refresh 重新拉取。
 */
export function useSpaceInfo() {
  const { t } = useTranslation()
  const [space, setSpace] = useState<SpaceInfo | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    try {
      setSpace(await getSpaceInfo())
    } catch {
      // 网络异常等未预期失败：明确提示而不是让用量条永远显示 '—'。
      toast.error(t('Failed to load cloud space'))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])

  return { space, refresh }
}
