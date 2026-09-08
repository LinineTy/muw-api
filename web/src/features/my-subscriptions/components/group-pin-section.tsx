// @muw-owned

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getGroupPinProducts, purchaseGroupPinBalance } from '@/features/profile/api'

/**
 * 固定分组商品区块（购买页）：列出上架商品，余额购买后组立即固定。
 * 无上架商品时整块不渲染。
 */
export function GroupPinCatalogSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [payingId, setPayingId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['group-pin', 'products'],
    queryFn: getGroupPinProducts,
  })

  const purchaseMutation = useMutation({
    mutationFn: purchaseGroupPinBalance,
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.data?.message ?? t('Fixed group activated'))
        queryClient.invalidateQueries({ queryKey: ['group-pin'] })
      } else {
        toast.error(res.message ?? t('Purchase failed'))
      }
    },
    onError: () => toast.error(t('Purchase failed')),
    onSettled: () => setPayingId(null),
  })

  const products = data?.data ?? []
  if (!isLoading && products.length === 0) return null

  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-sm font-semibold tracking-tight'>
        {t('Fixed Groups', '固定分组')}
      </h2>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {isLoading
          ? [1, 2, 3].map((i) => <Skeleton key={i} className='h-32 w-full' />)
          : products.map((product) => (
              <Card key={product.id} className='gap-3 py-4'>
                <CardHeader className='px-4'>
                  <CardTitle className='text-base'>{product.title}</CardTitle>
                  <CardDescription>
                    {t('Pins your account to group', '将账户固定到分组')}
                    <span className='text-foreground ml-1 font-medium'>
                      {product.group}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className='flex items-center justify-between px-4'>
                  <span className='text-lg font-semibold'>
                    ${product.price_amount.toFixed(2)}
                  </span>
                  <Button
                    size='sm'
                    disabled={payingId !== null}
                    onClick={() => {
                      setPayingId(product.id)
                      purchaseMutation.mutate(product.id)
                    }}
                  >
                    {t('Buy with Balance', '余额购买')}
                  </Button>
                </CardContent>
              </Card>
            ))}
      </div>
    </section>
  )
}
