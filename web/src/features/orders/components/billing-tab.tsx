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
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useBillingHistory } from '@/features/wallet/hooks/use-billing-history'
import {
  formatTimestamp,
  getPaymentMethodName,
  getStatusConfig,
} from '@/features/wallet/lib/billing'
import type { TopupRecord } from '@/features/wallet/types'

/**
 * 充值记录 / 订阅订单合并列表：服务端分页 + 搜索 + 类型/状态/支付方式筛选 + 视图切换。
 * 管理员可补单（充值 pending → 补 quota；订阅 pending → 补单创建订阅 / 驳回关闭）。
 */
export function BillingTab() {
  const { t } = useTranslation()
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [completeTarget, setCompleteTarget] = useState<string | null>(null)
  const [completeSubTarget, setCompleteSubTarget] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const { copyToClipboard, copiedText } = useCopyToClipboard({ notify: false })

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
  const typeFilter = useMemo(
    () =>
      (columnFilters.find((f) => f.id === 'type')?.value as
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
    completing,
    completingSub,
    isAdmin,
    handlePageChange,
    handlePageSizeChange,
    handleCompleteOrder,
    handleCompleteSubscriptionOrder,
    handleRejectSubscriptionOrder,
  } = useBillingHistory({
    keyword: globalFilter,
    status: statusFilter === 'all' ? '' : statusFilter,
    method: methodFilter === 'all' ? '' : methodFilter,
    type: typeFilter === 'all' ? '' : typeFilter,
  })

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: page - 1, pageSize }),
    [page, pageSize]
  )

  const columns = useMemo<ColumnDef<TopupRecord>[]>(() => {
    const cols: ColumnDef<TopupRecord>[] = [
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
        accessorKey: 'type',
        header: t('Type'),
        cell: ({ row }) =>
          row.original.type === 'subscription' ? (
            <StatusBadge
              label={t('Subscription')}
              variant='info'
              showDot
              copyable={false}
            />
          ) : (
            <StatusBadge
              label={t('Recharge')}
              variant='neutral'
              showDot
              copyable={false}
            />
          ),
        size: 110,
      },
      {
        accessorKey: 'plan_id',
        header: t('Plan'),
        cell: ({ row }) => {
          const record = row.original
          return record.type === 'subscription' ? (
            <span className='text-sm font-medium'>
              {record.plan_title || `#${record.plan_id}`}
            </span>
          ) : (
            <span className='text-muted-foreground text-sm'>-</span>
          )
        },
        size: 140,
      },
      {
        accessorKey: 'payment_method',
        header: t('Payment Method'),
        cell: ({ row }) => (
          <span className='text-sm font-medium'>
            {getPaymentMethodName(row.original.payment_method, t)}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: 'amount',
        header: t('Amount'),
        cell: ({ row }) => {
          const record = row.original
          return record.type === 'topup' ? (
            <span className='font-mono text-sm font-medium tabular-nums'>
              {formatNumber(record.amount || 0)}
            </span>
          ) : (
            <span className='text-muted-foreground text-sm'>-</span>
          )
        },
        size: 100,
      },
      {
        accessorKey: 'money',
        header: t('Payment'),
        cell: ({ row }) => (
          <span className='text-sm font-semibold text-red-600'>
            {formatCurrencyFromUSD(row.original.money, {
              digitsLarge: 2,
              digitsSmall: 2,
              abbreviate: false,
            })}
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
          const record = row.original
          if (!isAdmin || record.status !== 'pending') return null
          const busy = completing || completingSub !== null
          // 订阅订单：补单 / 驳回；充值订单：补单。
          if (record.type === 'subscription') {
            return (
              <div className='flex items-center gap-0.5'>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => setRejectTarget(record.trade_no)}
                  disabled={busy}
                  aria-label={t('Reject')}
                >
                  <Ban />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => setCompleteSubTarget(record.trade_no)}
                  disabled={busy}
                  aria-label={t('Complete Order')}
                >
                  <CheckCheck />
                </Button>
              </div>
            )
          }
          return (
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => setCompleteTarget(record.trade_no)}
              disabled={busy}
              aria-label={t('Complete Order')}
            >
              <CheckCheck />
            </Button>
          )
        },
        size: 70,
      }
    )

    return cols
  }, [
    t,
    isAdmin,
    completing,
    completingSub,
    copiedText,
    copyToClipboard,
  ])

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
    columnVisibilityStorageKey: 'orders-billing-column-visibility',
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

  const handleConfirmComplete = async () => {
    if (completeTarget) {
      const success = await handleCompleteOrder(completeTarget)
      if (success) {
        setCompleteTarget(null)
      }
    }
  }

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={loading}
        emptyTitle={t('No billing records found')}
        emptyDescription={
          globalFilter
            ? t('Try adjusting your search')
            : t('Your transaction history will appear here')
        }
        skeletonKeyPrefix='billing-tab-skeleton'
        fixedHeight={false}
        paginationInFooter={false}
        applyHeaderSize
        enableCardView
        viewModeStorageKey='orders-billing-view-mode'
        defaultViewMode={DATA_TABLE_VIEW_MODES.TABLE}
        toolbarProps={{
          searchPlaceholder: t('Search by order number...'),
          searchDebounceMs: 500,
          filters: [
            {
              columnId: 'type',
              title: t('Type'),
              options: [
                { label: 'All Types', value: 'all' },
                { label: 'Recharge', value: 'topup' },
                { label: 'Subscription', value: 'subscription' },
              ],
              singleSelect: true,
            },
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
              options: [
                { label: 'All Payment Methods', value: 'all' },
                { label: 'Alipay', value: 'alipay' },
                { label: 'WeChat Pay', value: 'wxpay' },
                { label: 'Balance', value: 'balance' },
              ],
              singleSelect: true,
            },
          ],
        }}
      />

      {/* Confirm Complete Topup Order */}
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
            <AlertDialogCancel disabled={completing}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmComplete}
              disabled={completing}
            >
              {completing ? t('Processing...') : t('Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Complete Subscription Order */}
      <AlertDialog
        open={!!completeSubTarget}
        onOpenChange={(open) => !open && setCompleteSubTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Complete Order')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Are you sure you want to manually complete this subscription order? The user will receive the corresponding subscription.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completingSub !== null}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (completeSubTarget) {
                  void handleCompleteSubscriptionOrder(completeSubTarget).then(
                    (ok) => {
                      if (ok) {
                        setCompleteSubTarget(null)
                      }
                    }
                  )
                }
              }}
              disabled={completingSub !== null}
            >
              {completingSub !== null ? t('Processing...') : t('Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Reject Subscription Order */}
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
            <AlertDialogCancel disabled={completingSub !== null}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejectTarget) {
                  void handleRejectSubscriptionOrder(rejectTarget).then(
                    (ok) => {
                      if (ok) {
                        setRejectTarget(null)
                      }
                    }
                  )
                }
              }}
              disabled={completingSub !== null}
            >
              {completingSub !== null ? t('Processing...') : t('Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
