// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'

import {
  deleteMyApplication,
  getMyApplications,
  type OAuthApplication,
} from '../api'
import { OAUTH_QUERY_KEY } from '../constants'
import { ApplicationDetailDialog } from './application-detail-dialog'
import { useMyApplicationsColumns } from './my-applications-columns'

export function MyApplicationsTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [detail, setDetail] = useState<OAuthApplication | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OAuthApplication | null>(
    null
  )
  const columns = useMyApplicationsColumns({
    onDetails: setDetail,
    onDelete: setDeleteTarget,
  })

  const query = useQuery({
    queryKey: [...OAUTH_QUERY_KEY, 'mine'],
    queryFn: getMyApplications,
  })
  const applications = query.data ?? []

  const { table } = useDataTable({
    data: applications,
    columns,
    columnVisibilityStorageKey: false,
    columnSizingStorageKey: false,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteMyApplication,
    onSuccess: async () => {
      toast.success(t('Deleted'))
      setDeleteTarget(null)
      await queryClient.invalidateQueries({ queryKey: OAUTH_QUERY_KEY })
    },
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No applications yet')}
        emptyDescription={t('Apps you asked this site to sign users in with.')}
        skeletonKeyPrefix='oauth-applications-skeleton'
        toolbarProps={{ searchPlaceholder: t('Filter by name...') }}
        className='min-h-0 flex-1'
      />

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('Delete this application?')}
        desc={t(
          'Are you sure you want to delete application "{{name}}"? This action cannot be undone.',
          { name: deleteTarget?.name ?? '' }
        )}
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
      />
    </div>
  )
}
