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
        throw new Error(res.message || i18next.t('Failed to load images'))
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
        toast.success(i18next.t('Image uploaded'))
        invalidate.onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to upload image'))
    },
  })
}

export function useDeleteImage() {
  const invalidate = useInvalidateImages()

  return useMutation({
    mutationFn: (id: number) => deleteImage(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(i18next.t('Image deleted'))
        invalidate.onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to delete image'))
    },
  })
}
