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
import type {
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table'
import { Ban, Check, CheckCheck, Copy } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DATA_TABLE_VIEW_MODES,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatNumber } from '@/lib/format'
import {
  formatTimestamp,
  getPaymentMethodName,
  getStatusConfig,
} from '@/features/wallet/lib/billing'

import { useSpaceOrders } from '../hooks/use-space-orders'
import { usePaymentMethodOptions } from '../hooks/use-payment-method-options'
import type { SpaceOrderRecord } from '../types'

/**
 * 云空间购买订单列表：服务端分页 + 搜索/状态/支付方式筛选 + 视图切换 + 管理员补单/驳回。
 * 用户看本人，管理员看全平台。工具栏能力与渠道页对齐；筛选 options 与渠道页一致在渲染时内联构建。
 */
export function SpaceOrdersTab() {
  const { t } = useTranslation()
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [completeTarget, setCompleteTarget] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const { copyToClipboard, copiedText } = useCopyToClipboard({ notify: false })
  // 支付方式筛选选项与列显示名均来自管理员配置的 PayMethods（云空间订单无余额支付，不追加「余额」）。
  const { payMethods, options: methodOptions } = usePaymentMethodOptions(false)

  const statusFilter = useMemo(
    () =>
      (columnFilters.find((f) => f.id === 'status')?.value as
        | string[]
        | undefined)?.[0] ?? '',
    [columnFilters]
  )
  const methodFilter = useMemo(
    () =>
      (columnFilters.find((f) => f.id === 'payment_method')?.value as
        | string[]
        | undefined)?.[0] ?? '',
    [columnFilters]
  )

  const {
    records,
    total,
    page,
    pageSize,
    loading,
    isAdmin,
    completing,
    handlePageChange,
    handlePageSizeChange,
    handleCompleteOrder,
    handleRejectOrder,
  } = useSpaceOrders({
    keyword: globalFilter,
    status: statusFilter === 'all' ? '' : statusFilter,
    method: methodFilter === 'all' ? '' : methodFilter,
  })

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: page - 1, pageSize }),
    [page, pageSize]
  )

  const columns = useMemo<ColumnDef<SpaceOrderRecord>[]>(() => {
    const cols: ColumnDef<SpaceOrderRecord>[] = [
      {
        accessorKey: 'trade_no',
        header: t('Order Number'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='flex min-w-0 items-center gap-1'>
            <code className='text-foreground truncate font-mono text-sm'>
              {row.original.trade_no}
            </code>
            <Button
              variant='ghost'
              size='sm'
              className='h-5 w-5 shrink-0 p-0'
              onClick={() => copyToClipboard(row.original.trade_no)}
            >
              {copiedText === row.original.trade_no ? (
                <Check className='h-3 w-3' />
              ) : (
                <Copy className='h-3 w-3' />
              )}
            </Button>
          </div>
        ),
        size: 220,
      },
      {
        accessorKey: 'create_time',
        header: t('Time'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap'>
            {formatTimestamp(row.original.create_time)}
          </span>
        ),
        size: 160,
      },
    ]

    if (isAdmin) {
      cols.push({
        accessorKey: 'user_id',
        header: t('User ID'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <StatusBadge
            label={String(row.original.user_id)}
            variant='neutral'
            size='sm'
            copyText={String(row.original.user_id)}
          />
        ),
        size: 90,
      })
    }

    cols.push(
      {
        accessorKey: 'mb',
        header: t('Capacity'),
        cell: ({ row }) => (
          <span className='text-sm font-medium'>{row.original.mb} MB</span>
        ),
        size: 100,
      },
      {
        accessorKey: 'payment_method',
        header: t('Payment Method'),
        cell: ({ row }) => (
          <span className='text-sm font-medium'>
            {getPaymentMethodName(row.original.payment_method, t, payMethods)}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: 'money',
        header: t('Payment'),
        cell: ({ row }) => (
          <span className='text-sm font-semibold text-red-600'>
            {formatNumber(row.original.money)}
          </span>
        ),
        size: 90,
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => {
          const statusConfig = getStatusConfig(row.original.status)
          return (
            <StatusBadge
              label={t(statusConfig.label)}
              variant={statusConfig.variant}
              showDot
              copyable={false}
            />
          )
        },
        size: 110,
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => {
          if (!isAdmin || row.original.status !== 'pending') return null
          const tradeNo = row.original.trade_no
          const busy = completing !== null
          return (
            <div className='flex items-center gap-0.5'>
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={() => setRejectTarget(tradeNo)}
                disabled={busy}
                aria-label={t('Reject')}
              >
                <Ban />
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={() => setCompleteTarget(tradeNo)}
                disabled={busy}
                aria-label={t('Complete Order')}
              >
                <CheckCheck />
              </Button>
            </div>
          )
        },
        size: 70,
      }
    )

    return cols
  }, [t, isAdmin, completing, copiedText, copyToClipboard, payMethods])

  const resetPage = useCallback(() => {
    if (page > 1) {
      handlePageChange(1)
    }
  }, [page, handlePageChange])

  const onGlobalFilterChange = useCallback<OnChangeFn<string>>(
    (updater) => {
      setGlobalFilter((previous) =>
        typeof updater === 'function' ? updater(previous) : updater
      )
      resetPage()
    },
    [resetPage]
  )

  const onColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>(
    (updater) => {
      setColumnFilters((previous) =>
        typeof updater === 'function' ? updater(previous) : updater
      )
      resetPage()
    },
    [resetPage]
  )

  const { table } = useDataTable({
    data: records,
    columns,
    manualPagination: true,
    manualFiltering: true,
    totalCount: total,
    pagination,
    columnVisibilityStorageKey: 'orders-space-column-visibility',
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? (updater as (old: PaginationState) => PaginationState)(pagination)
          : updater
      if (next.pageSize !== pagination.pageSize) {
        handlePageSizeChange(next.pageSize)
      } else if (next.pageIndex !== pagination.pageIndex) {
        handlePageChange(next.pageIndex + 1)
      }
    },
    ensurePageInRange: (pageCount) => {
      if (pageCount > 0 && page > pageCount) {
        handlePageChange(pageCount)
      }
    },
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
  })

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={loading}
        emptyTitle={t('No orders found')}
        emptyDescription={
          globalFilter
            ? t('Try adjusting your search')
            : t('Your cloud space purchase history will appear here')
        }
        skeletonKeyPrefix='space-orders-tab-skeleton'
        fixedHeight={false}
        paginationInFooter={false}
        applyHeaderSize
        enableCardView
        viewModeStorageKey='orders-space-view-mode'
        defaultViewMode={DATA_TABLE_VIEW_MODES.TABLE}
        toolbarProps={{
          searchPlaceholder: t('Search by order number...'),
          searchDebounceMs: 500,
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: [
                { label: 'All Statuses', value: 'all' },
                { label: 'Success', value: 'success' },
                { label: 'Pending', value: 'pending' },
                { label: 'Expired', value: 'expired' },
              ],
              singleSelect: true,
            },
            {
              columnId: 'payment_method',
              title: t('Payment Method'),
              options: methodOptions,
              singleSelect: true,
            },
          ],
        }}
      />

      {/* Confirm Complete Order */}
      <AlertDialog
        open={!!completeTarget}
        onOpenChange={(open) => !open && setCompleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Complete Order')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Are you sure you want to manually complete this order? The user will be credited with the corresponding quota.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completing !== null}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (completeTarget) {
                  void handleCompleteOrder(completeTarget).then((ok) => {
                    if (ok) {
                      setCompleteTarget(null)
                    }
                  })
                }
              }}
              disabled={completing !== null}
            >
              {completing !== null ? t('Processing...') : t('Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Reject Order */}
      <AlertDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Reject Order')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Are you sure you want to reject this order? The user will not be charged for it.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completing !== null}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejectTarget) {
                  void handleRejectOrder(rejectTarget).then((ok) => {
                    if (ok) {
                      setRejectTarget(null)
                    }
                  })
                }
              }}
              disabled={completing !== null}
            >
              {completing !== null ? t('Processing...') : t('Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
