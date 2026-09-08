// @muw-owned

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { getMyGroupPin } from '../api'

/**
 * 固定分组卡片：用户被管理员固定（或购买了）分组时展示当前钉住的组；
 * 无钉时不渲染。
 */
export function GroupPinCard() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['group-pin', 'self'],
    queryFn: getMyGroupPin,
    retry: false,
  })

  const pin = data?.data ?? null

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-5 w-28' />
          <Skeleton className='h-4 w-48' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-6 w-24' />
        </CardContent>
      </Card>
    )
  }

  if (!pin) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.group_pin.title', '固定分组')}</CardTitle>
        <CardDescription>
          {t(
            'profile.group_pin.description',
            '你的账户被固定在以下分组，订阅到期后不会回落'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant='secondary' className='text-sm'>
          {pin.group}
        </Badge>
      </CardContent>
    </Card>
  )
}
