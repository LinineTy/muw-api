// @muw-owned

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SubscriptionsMutateDrawer } from './subscriptions-mutate-drawer'
import {
  adminDeleteGroupPinProduct,
  adminListGroupPinProducts,
  adminListGroupPins,
  adminReleaseGroupPin,
  type AdminGroupPinProduct,
} from '../api'

export function AdminGroupPinSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminGroupPinProduct | null>(null)

  const productsQuery = useQuery({
    queryKey: ['admin-group-pin-products'],
    queryFn: adminListGroupPinProducts,
  })
  const pinsQuery = useQuery({
    queryKey: ['admin-group-pins'],
    queryFn: () => adminListGroupPins({ page: 1, page_size: 50 }),
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-group-pin-products'] })
    queryClient.invalidateQueries({ queryKey: ['admin-group-pins'] })
  }

  const deleteMutation = useMutation({
    mutationFn: adminDeleteGroupPinProduct,
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted'))
        invalidateAll()
      } else {
        toast.error(res.message)
      }
    },
  })

  const releaseMutation = useMutation({
    mutationFn: (pinId: number) => adminReleaseGroupPin(pinId, 'admin release'),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Fixed group removed'))
        invalidateAll()
      } else {
        toast.error(res.message)
      }
    },
  })

  const products = productsQuery.data?.data ?? []
  const pins = pinsQuery.data?.data?.items ?? []

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle className='text-base'>
            {t('Fixed Group Products')}
          </CardTitle>
          <Button
            size='sm'
            onClick={() => {
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            {t('New Product')}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Title')}</TableHead>
                <TableHead>{t('Group')}</TableHead>
                <TableHead>{t('Price')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead className='text-right'>{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>{product.title}</TableCell>
                  <TableCell>
                    <Badge variant='secondary'>{product.group}</Badge>
                  </TableCell>
                  <TableCell>${product.price_amount.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={product.enabled ? 'default' : 'outline'}>
                      {product.enabled ? t('Enabled') : t('Disabled')}
                    </Badge>
                  </TableCell>
                  <TableCell className='space-x-2 text-right'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        setEditing(product)
                        setEditorOpen(true)
                      }}
                    >
                      {t('Edit')}
                    </Button>
                    <Button
                      size='sm'
                      variant='destructive'
                      onClick={() => deleteMutation.mutate(product.id)}
                    >
                      {t('Delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>
            {t('User Fixed Group Pins')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('User ID')}</TableHead>
                <TableHead>{t('Group')}</TableHead>
                <TableHead>{t('Source')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead className='text-right'>{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pins.map((pin) => (
                <TableRow key={pin.id}>
                  <TableCell>{pin.user_id}</TableCell>
                  <TableCell>
                    <Badge variant='secondary'>{pin.group}</Badge>
                  </TableCell>
                  <TableCell>{pin.source}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        pin.status === 'active' ? 'default' : 'outline'
                      }
                    >
                      {pin.status}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right'>
                    {pin.status === 'active' && (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={releaseMutation.isPending}
                        onClick={() => releaseMutation.mutate(pin.id)}
                      >
                        {t('Unpin')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 商品编辑复用订阅配置抽屉（特殊订阅，顶部 Tabs 切换类型） */}
      <SubscriptionsMutateDrawer
        open={editorOpen}
        onOpenChange={(v) => !v && setEditorOpen(false)}
        groupPinProduct={editing ?? undefined}
      />
    </div>
  )
}
