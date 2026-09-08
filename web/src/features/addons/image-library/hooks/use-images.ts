// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import { deleteImage, getImages, uploadImage } from '../api'
import type { ImageAsset } from '../types'

export const imagesQueryKey = ['image-library']

export function useImages() {
  return useQuery<ImageAsset[]>({
    queryKey: imagesQueryKey,
    queryFn: async () => {
      const res = await getImages()
      if (!res.success || !res.data) {
        throw new Error(res.message || i18next.t('Failed to load files'))
      }
      return res.data
    },
  })
}

function useInvalidateImages() {
  const queryClient = useQueryClient()
  return {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: imagesQueryKey })
    },
  }
}

export function useUploadImage() {
  const invalidate = useInvalidateImages()

  return useMutation({
    mutationFn: (file: File) => uploadImage(file),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(i18next.t('File uploaded'))
        invalidate.onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to upload file'))
    },
  })
}

export function useDeleteImage() {
  const invalidate = useInvalidateImages()

  return useMutation({
    mutationFn: (id: number) => deleteImage(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(i18next.t('File deleted'))
        invalidate.onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to delete file'))
    },
  })
}
