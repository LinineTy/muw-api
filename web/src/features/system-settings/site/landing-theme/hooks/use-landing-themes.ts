// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import {
  deleteLandingTheme,
  getLandingThemes,
  importLandingTheme,
  selectLandingTheme,
  updateManualTheme,
} from '../api'
import type { LandingManual, LandingThemeListData } from '../types'

export const landingThemesQueryKey = ['landing-themes']

// 主题切换会改写 HomePageContent/About/legal,同步失效系统设置表单缓存,让
// "系统信息"区的文本域(若有)与当前生效内容保持一致。协议/隐私页查询
// staleTime 10min,不主动失效会继续用旧缓存;About/营销页挂载即重拉,一并失效保证一致。
function useInvalidateOnSuccess() {
  const queryClient = useQueryClient()
  return {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: landingThemesQueryKey })
      queryClient.invalidateQueries({ queryKey: ['system-options'] })
      queryClient.invalidateQueries({ queryKey: ['about-content'] })
      queryClient.invalidateQueries({ queryKey: ['user-agreement'] })
      queryClient.invalidateQueries({ queryKey: ['privacy-policy'] })
    },
  }
}

export function useLandingThemes() {
  return useQuery<LandingThemeListData>({
    queryKey: landingThemesQueryKey,
    queryFn: async () => {
      const res = await getLandingThemes()
      if (!res.success || !res.data) {
        throw new Error(res.message || i18next.t('Failed to load themes'))
      }
      return res.data
    },
  })
}

export function useImportLandingTheme() {
  const invalidate = useInvalidateOnSuccess()

  return useMutation({
    mutationFn: (body: { name: string; file: File }) =>
      importLandingTheme(body),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(i18next.t('Theme imported successfully'))
        invalidate.onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to import theme'))
    },
  })
}

export function useSelectLandingTheme() {
  const invalidate = useInvalidateOnSuccess()

  return useMutation({
    mutationFn: (id: string) => selectLandingTheme(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(i18next.t('Theme selected'))
        invalidate.onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to select theme'))
    },
  })
}

export function useUpdateManualTheme() {
  const invalidate = useInvalidateOnSuccess()

  return useMutation({
    mutationFn: (body: LandingManual) => updateManualTheme(body),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(i18next.t('Manual theme saved'))
        invalidate.onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to save manual theme'))
    },
  })
}

export function useDeleteLandingTheme() {
  const invalidate = useInvalidateOnSuccess()

  return useMutation({
    mutationFn: (id: string) => deleteLandingTheme(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(i18next.t('Theme deleted'))
        invalidate.onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to delete theme'))
    },
  })
}
