// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnFiltersState, PaginationState } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  deleteApplication,
  listApplicationsForReview,
  reviewApplication,
  updateApplicationStatus,
  type OAuthApplication,
} from '../api'
import {
  APPLICATION_STATUS_FILTER,
  APPLICATION_STATUS_LABELS,
  OAUTH_QUERY_KEY,
} from '../constants'
import { scopeTextList } from '../scopes'
import { useReviewQueueColumns } from './review-queue-columns'

export function ReviewQueueTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([
    { id: 'status', value: ['pending'] },
  ])
  const [reviewTarget, setReviewTarget] = useState<{
    application: OAuthApplication
    action: 'approve' | 'reject'
  } | null>(null)
  const [disableTarget, setDisableTarget] = useState<OAuthApplication | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] = useState<OAuthApplication | null>(
    null
  )
  const [note, setNote] = useState('')

  const status =
    (
      columnFilters.find((filter) => filter.id === 'status')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''

  const query = useQuery({
    queryKey: [
      ...OAUTH_QUERY_KEY,
      'review',
      status,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: () =>
      listApplicationsForReview({
        status,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      }),
    placeholderData: (previous) => previous,
  })
  const items = query.data?.items ?? []

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: OAUTH_QUERY_KEY })

  const reviewMutation = useMutation({
    mutationFn: (input: {
      application: OAuthApplication
      action: 'approve' | 'reject'
      note: string
    }) =>
      reviewApplication(input.application.id, {
        action: input.action,
        scopes: input.application.scopes,
        redirect_uris: input.application.redirect_uris,
        allowed_groups: input.application.allowed_groups ?? [],
        note: input.note,
      }),
    onSuccess: async (_data, input) => {
      toast.success(input.action === 'approve' ? t('Approved') : t('Rejected'))
      setReviewTarget(null)
      setNote('')
      await refresh()
    },
  })

  const statusMutation = useMutation({
    mutationFn: (application: OAuthApplication) =>
      updateApplicationStatus(application.id, 'disable'),
    onSuccess: async () => {
      toast.success(t('Disabled'))
      setDisableTarget(null)
      await refresh()
    },
  })

  const enableMutation = useMutation({
    mutationFn: (application: OAuthApplication) =>
      updateApplicationStatus(application.id, 'approve'),
    onSuccess: async () => {
      toast.success(t('Approved'))
      await refresh()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (application: OAuthApplication) =>
      deleteApplication(application.id),
    onSuccess: async () => {
      toast.success(t('Deleted'))
      setDeleteTarget(null)
      await refresh()
    },
  })

  const busy =
    reviewMutation.isPending ||
    statusMutation.isPending ||
    enableMutation.isPending ||
    deleteMutation.isPending

  const columns = useReviewQueueColumns({
    busy,
    onApprove: (application) => {
      setNote('')
      setReviewTarget({ application, action: 'approve' })
    },
    onReject: (application) => {
      setNote('')
      setReviewTarget({ application, action: 'reject' })
    },
    onToggleStatus: (application) => {
      if (application.status === 'approved') {
        setDisableTarget(application)
        return
      }
      enableMutation.mutate(application)
    },
    onDelete: setDeleteTarget,
  })

  const { table } = useDataTable({
    data: items,
    columns,
    columnFilters,
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater)
      setPagination((previous) => ({ ...previous, pageIndex: 0 }))
    },
    pagination,
    onPaginationChange: setPagination,
    manualFiltering: true,
    manualPagination: true,
    enableSorting: false,
    totalCount: query.data?.total ?? 0,
    ensurePageInRange: (pageCount) => {
      if (query.isSuccess && pagination.pageIndex >= Math.max(1, pageCount)) {
        setPagination((previous) => ({
          ...previous,
          pageIndex: Math.max(0, pageCount - 1),
        }))
      }
    },
    columnVisibilityStorageKey: false,
    columnSizingStorageKey: false,
  })

  const reviewApp = reviewTarget?.application

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No applications')}
        emptyDescription={t(
          'Applications only work after approval. Callback addresses are matched exactly.'
        )}
        skeletonKeyPrefix='oauth-review-skeleton'
        toolbarProps={{
          // 审核接口没有关键字搜索，这里只留状态筛选，避免放一个不生效的搜索框。
          customSearch: null,
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: APPLICATION_STATUS_FILTER.map((value) => ({
                value,
                label: t(APPLICATION_STATUS_LABELS[value]),
              })),
              singleSelect: true,
            },
          ],
        }}
        className='min-h-0 flex-1'
      />

      <ConfirmDialog
        open={reviewTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReviewTarget(null)
        }}
        title={
          reviewTarget?.action === 'approve'
            ? t('Approve as applied')
            : t('Reject')
        }
        desc={t(
          'Applications only work after approval. Callback addresses are matched exactly.'
        )}
        confirmText={
          reviewTarget?.action === 'approve'
            ? t('Approve as applied')
            : t('Reject')
        }
        isLoading={reviewMutation.isPending}
        handleConfirm={() => {
          if (reviewTarget) reviewMutation.mutate({ ...reviewTarget, note })
        }}
      >
        {reviewApp ? (
          <div className='flex flex-col gap-2 text-sm'>
            <span className='flex flex-wrap gap-x-2'>
              <span className='text-muted-foreground'>{t('Requested by')}</span>
              <span>{reviewApp.owner_username || '-'}</span>
            </span>
            <span className='flex flex-wrap gap-x-2'>
              <span className='text-muted-foreground'>
                {t('Requested scopes')}
              </span>
              <span>{scopeTextList(reviewApp.scopes, t).join(' · ')}</span>
            </span>
            <span className='flex flex-col gap-1'>
              <span className='text-muted-foreground'>
                {t('Redirect URIs')}
              </span>
              {reviewApp.redirect_uris.map((uri) => (
                <span key={uri} className='font-mono text-xs'>
                  {uri}
                </span>
              ))}
            </span>
            {reviewApp.apply_reason ? (
              <span className='flex flex-wrap gap-x-2'>
                <span className='text-muted-foreground'>
                  {t('Reason for the request')}
                </span>
                <span>{reviewApp.apply_reason}</span>
              </span>
            ) : null}
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='oauth-review-note'>{t('Review note')}</Label>
              <Textarea
                id='oauth-review-note'
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={disableTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisableTarget(null)
        }}
        title={t('Disable')}
        desc={t(
          'Are you sure you want to disable application "{{name}}"? Users can no longer sign in with it.',
          { name: disableTarget?.name ?? '' }
        )}
        destructive
        isLoading={statusMutation.isPending}
        handleConfirm={() => {
          if (disableTarget) statusMutation.mutate(disableTarget)
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('Delete')}
        desc={t(
          'Are you sure you want to delete application "{{name}}"? This action cannot be undone.',
          { name: deleteTarget?.name ?? '' }
        )}
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget)
        }}
      />
    </div>
  )
}
