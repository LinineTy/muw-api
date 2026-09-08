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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  adminDeleteGroupPinProduct,
  adminListGroupPinProducts,
  adminListGroupPins,
  adminReleaseGroupPin,
  adminSaveGroupPinProduct,
  type AdminGroupPinProduct,
} from '../api'

function ProductEditorDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean
  onClose: () => void
  editing: AdminGroupPinProduct | null
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(editing?.title ?? '')
  const [group, setGroup] = useState(editing?.group ?? '')
  const [price, setPrice] = useState(String(editing?.price_amount ?? '0'))
  const [sortOrder, setSortOrder] = useState(String(editing?.sort_order ?? '0'))

  const saveMutation = useMutation({
    mutationFn: adminSaveGroupPinProduct,
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Saved'))
        queryClient.invalidateQueries({ queryKey: ['admin-group-pin-products'] })
        onClose()
      } else {
        toast.error(res.message)
      }
    },
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? t('Edit Product') : t('New Product')}
          </DialogTitle>
        </DialogHeader>
        <div className='grid gap-3 py-2'>
          <div className='grid gap-1.5'>
            <Label>{t('Title')}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className='grid gap-1.5'>
            <Label>{t('Group')}</Label>
            <Input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder='tier1-permanent'
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-1.5'>
              <Label>{t('Price')} ($)</Label>
              <Input
                type='number'
                min='0'
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label>{t('Sort Order')}</Label>
              <Input
                type='number'
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={saveMutation.isPending || !title || !group}
            onClick={() =>
              saveMutation.mutate({
                id: editing?.id,
                title,
                group,
                price_amount: Number(price) || 0,
                enabled: true,
                sort_order: Number(sortOrder) || 0,
              })
            }
          >
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 管理端固定分组区块：商品管理 + 钉子列表/解除。挂在订阅管理页"固定分组"tab。
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

      {editorOpen && (
        <ProductEditorDialog
          open
          editing={editing}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  )
}
