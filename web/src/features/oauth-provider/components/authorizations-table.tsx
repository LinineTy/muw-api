// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'

import {
  getMyConsents,
  revokeConsent,
  setConsentSilent,
  type OAuthConsent,
} from '../api'
import { OAUTH_QUERY_KEY } from '../constants'
import { useAuthorizationsColumns } from './authorizations-columns'

const CONSENTS_QUERY_KEY = [...OAUTH_QUERY_KEY, 'consents']

export function AuthorizationsTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<OAuthConsent | null>(null)

  const query = useQuery({
    queryKey: CONSENTS_QUERY_KEY,
    queryFn: getMyConsents,
  })
  const consents = query.data ?? []

  const silentMutation = useMutation({
    mutationFn: (input: { clientId: string; silent: boolean }) =>
      setConsentSilent(input.clientId, input.silent),
    // 开关状态先本地翻过去，失败回滚，避免"点了又弹回来"。
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: CONSENTS_QUERY_KEY })
      const previous =
        queryClient.getQueryData<OAuthConsent[]>(CONSENTS_QUERY_KEY)
      queryClient.setQueryData<OAuthConsent[]>(CONSENTS_QUERY_KEY, (current) =>
        current?.map((consent) =>
          consent.client_id === input.clientId
            ? { ...consent, silent: input.silent }
            : consent
        )
      )
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(CONSENTS_QUERY_KEY, context.previous)
      }
    },
    onSuccess: () => toast.success(t('Saved')),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: OAUTH_QUERY_KEY }),
  })

  const revokeMutation = useMutation({
    mutationFn: revokeConsent,
    onSuccess: async () => {
      toast.success(t('Authorization revoked'))
      setRevokeTarget(null)
      await queryClient.invalidateQueries({ queryKey: OAUTH_QUERY_KEY })
    },
  })

  const columns = useAuthorizationsColumns({
    silentPending: silentMutation.isPending,
    onToggleSilent: (consent, silent) =>
      silentMutation.mutate({ clientId: consent.client_id, silent }),
    onRevoke: setRevokeTarget,
  })

  const { table } = useDataTable({
    data: consents,
    columns,
    columnVisibilityStorageKey: false,
    columnSizingStorageKey: false,
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No authorizations yet')}
        emptyDescription={t('Where your account was used to sign in.')}
        skeletonKeyPrefix='oauth-authorizations-skeleton'
        toolbarProps={{ searchPlaceholder: t('Filter by name...') }}
        className='min-h-0 flex-1'
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        title={t('Revoke')}
        desc={t('Stop letting {{name}} sign users in with your account.', {
          name: revokeTarget?.client_name ?? '',
        })}
        destructive
        isLoading={revokeMutation.isPending}
        handleConfirm={() => {
          if (revokeTarget) revokeMutation.mutate(revokeTarget.client_id)
        }}
      />
    </div>
  )
}
