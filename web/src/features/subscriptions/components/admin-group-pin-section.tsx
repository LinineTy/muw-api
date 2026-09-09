// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'

import {
  adminDeleteGroupPinProduct,
  adminListGroupPinProducts,
  adminListGroupPins,
  adminReleaseGroupPin,
  type AdminGroupPinProduct,
} from '../api'
import { useGroupPinColumns, useGroupPinProductColumns } from './admin-group-pin-columns'
import { SubscriptionsMutateDrawer } from './subscriptions-mutate-drawer'

/**
 * 固定分组管理（订阅页 tab）：商品表 + 用户钉子表，
 * 与订阅查看页同写法（useDataTable + DataTablePage：工具栏搜索/分页/列行为全对齐）。
 */
export function AdminGroupPinSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminGroupPinProduct | null>(null)
  const [deleting, setDeleting] = useState<AdminGroupPinProduct | null>(null)
  const [pinSearch, setPinSearch] = useState('')
  const [pinPagination, setPinPagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  })

  const productsQuery = useQuery({
    queryKey: ['admin-group-pin-products'],
    queryFn: adminListGroupPinProducts,
  })
  const searchUserId = Number.parseInt(pinSearch.trim(), 10)
  const pinsQuery = useQuery({
    queryKey: [
      'admin-group-pins',
      pinPagination.pageIndex + 1,
      pinPagination.pageSize,
      Number.isNaN(searchUserId) ? 0 : searchUserId,
    ],
    queryFn: () =>
      adminListGroupPins({
        page: pinPagination.pageIndex + 1,
        page_size: pinPagination.pageSize,
        user_id: Number.isNaN(searchUserId) ? undefined : searchUserId,
      }),
    placeholderData: (previousData) => previousData,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-group-pin-products'] })
    queryClient.invalidateQueries({ queryKey: ['admin-group-pins'] })
  }

  const deleteMutation = useMutation({
    mutationFn: adminDeleteGroupPinProduct,
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted successfully'))
        setDeleting(null)
        invalidateAll()
      } else {
        toast.error(res.message || t('Operation failed'))
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
        toast.error(res.message || t('Operation failed'))
      }
    },
  })

  const products = productsQuery.data?.data ?? []
  const pins = pinsQuery.data?.data?.items ?? []
  const pinsTotal = pinsQuery.data?.data?.total || 0

  // ---- 商品表：客户端搜索（数据量小，同订阅套餐表配置） ----
  const productColumns = useGroupPinProductColumns({
    onEdit: (product) => {
      setEditing(product)
      setEditorOpen(true)
    },
    onDelete: (product) => setDeleting(product),
  })
  const { table: productTable } = useDataTable({
    data: products,
    columns: productColumns,
    withFacetedRowModel: false,
  })

  // ---- 钉子表：服务端分页 + user_id 过滤（同历史订阅表的手动模式） ----
  const pinColumns = useGroupPinColumns({
    onRelease: (pin) => releaseMutation.mutate(pin.id),
  })
  const { table: pinTable } = useDataTable({
    data: pins,
    columns: pinColumns,
    globalFilter: pinSearch,
    onGlobalFilterChange: setPinSearch,
    globalFilterFn: () => true,
    manualFiltering: true,
    manualPagination: true,
    totalCount: pinsTotal,
    pagination: pinPagination,
    onPaginationChange: setPinPagination,
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      <section className='flex flex-col gap-3'>
        <div className='flex items-center justify-between'>
          <h3 className='text-sm font-semibold tracking-tight'>
            {t('Fixed Group Products')}
          </h3>
          <Button
            size='sm'
            onClick={() => {
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            {t('New Product')}
          </Button>
        </div>
        <DataTablePage
          table={productTable}
          columns={productColumns}
          isLoading={productsQuery.isLoading}
          emptyTitle={t('No fixed group products')}
          emptyDescription={t(
            'Click "New Product" to create your first fixed group product'
          )}
          skeletonKeyPrefix='admin-group-pin-products-skeleton'
          toolbarProps={{
            searchPlaceholder: t('Filter products...'),
          }}
          applyHeaderSize
          /* 分页器跟随表格（内联）：默认的 footer portal 会把它传到页面底部，
             与钉子表的 footer 分页器叠在一起 */
          paginationInFooter={false}
        />
      </section>

      <section className='flex min-h-0 flex-1 flex-col gap-3'>
        <h3 className='text-sm font-semibold tracking-tight'>
          {t('User Fixed Group Pins')}
        </h3>
        <DataTablePage
          table={pinTable}
          columns={pinColumns}
          isLoading={pinsQuery.isLoading}
          isFetching={pinsQuery.isFetching}
          emptyTitle={t('No user group pins')}
          emptyDescription={t('No user group pins')}
          skeletonKeyPrefix='admin-group-pins-skeleton'
          applyHeaderSize
          toolbarProps={{
            searchPlaceholder: t('Filter by user ID'),
          }}
          className='min-h-0 flex-1'
        />
      </section>

      {/* 商品编辑复用订阅配置抽屉（特殊订阅，顶部 Tabs 切换类型） */}
      <SubscriptionsMutateDrawer
        open={editorOpen}
        onOpenChange={(v) => !v && setEditorOpen(false)}
        groupPinProduct={editing ?? undefined}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={
          <>
            <Trash2 className='h-4 w-4' />
            {t('Confirm delete')}
          </>
        }
        desc={t(
          'Delete fixed group product "{{title}}"? This cannot be undone.',
          { title: deleting?.title ?? '' }
        )}
        handleConfirm={() => {
          if (deleting) {
            deleteMutation.mutate(deleting.id)
          }
        }}
        isLoading={deleteMutation.isPending}
        confirmText={t('Delete')}
        destructive
      />
    </div>
  )
}
