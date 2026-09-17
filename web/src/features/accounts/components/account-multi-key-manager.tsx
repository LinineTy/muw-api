// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  MULTI_KEY_CONFIRM_MESSAGES,
  MULTI_KEY_STATUS,
} from '@/features/channels/constants'
import { getMultiKeyStatusConfig } from '@/features/channels/lib'
import type { KeyStatus } from '@/features/channels/types'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  addAccountMultiKeys,
  deleteAccountMultiKey,
  disableAccountMultiKey,
  enableAccountMultiKey,
  getAccountMultiKeyStatus,
} from '../api'

const PAGE_SIZE = 10

type AccountMultiKeyManagerProps = {
  accountId: number
  /** 追加成功后的总把数：抽屉据此同步「多密钥模式」开关（>1 把即多密钥） */
  onKeysChanged?: (total: number) => void
}

type MultiKeyActionInput =
  | { action: 'add'; keys: string[] }
  | { action: 'enable' | 'disable' | 'delete'; keyIndex: number }

/**
 * fork 自研：账户抽屉里的多密钥管理区块。
 *
 * 为什么要有它：账户凭证是多密钥的唯一真相源，但页面只有「整体替换 key」的入口
 * （抽屉里的 key 输入框不回填旧值，填了就是整串替换），既看不到现有几把 key，
 * 也没法追加 / 删单把 / 单把启停。这里直接复用渠道侧同一套后端动作
 * （/api/account/multi_key/manage → controller.ManageMultiKeys），key 全程只显示
 * 服务端给的脱敏预览。
 */
export function AccountMultiKeyManager(props: AccountMultiKeyManagerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.auth.user)
  const canSensitiveWrite = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.SENSITIVE_WRITE
  )

  const [page, setPage] = useState(1)
  const [appendInput, setAppendInput] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<KeyStatus | null>(null)

  const statusQuery = useQuery({
    queryKey: ['account-multi-key-status', props.accountId, page],
    enabled: props.accountId > 0,
    queryFn: async () => {
      const response = await getAccountMultiKeyStatus(
        props.accountId,
        page,
        PAGE_SIZE
      )
      if (!response.success || !response.data) {
        throw createServerError(response, t('Failed to load key status'))
      }
      return response.data
    },
  })

  const actionMutation = useMutation({
    mutationFn: (input: MultiKeyActionInput) => {
      if (input.action === 'add') {
        return addAccountMultiKeys(props.accountId, input.keys)
      }
      if (input.action === 'enable') {
        return enableAccountMultiKey(props.accountId, input.keyIndex)
      }
      if (input.action === 'disable') {
        return disableAccountMultiKey(props.accountId, input.keyIndex)
      }
      return deleteAccountMultiKey(props.accountId, input.keyIndex)
    },
    onSuccess: (response, input) => {
      if (!response.success) {
        handleServerError(response, t('Operation failed'))
        return
      }
      toast.success(response.message || t('Operation successful'))
      // 删掉当前页最后一把时回退一页，否则会停在空页上
      const isLastRowOnPage =
        input.action === 'delete' && (statusQuery.data?.keys.length ?? 0) === 1
      if (isLastRowOnPage && page > 1) {
        setPage(page - 1)
      }
      if (input.action === 'add') {
        setAppendInput('')
        props.onKeysChanged?.(response.data?.total ?? 0)
      }
      void queryClient.invalidateQueries({
        queryKey: ['account-multi-key-status', props.accountId],
      })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (error: unknown) => {
      handleServerError(error, t('Operation failed'))
    },
    onSettled: () => {
      setDeleteTarget(null)
    },
  })

  const keys = statusQuery.data?.keys ?? []
  const total = statusQuery.data?.total ?? 0
  const totalPages = statusQuery.data?.total_pages ?? 1
  const isMutating = actionMutation.isPending
  const canAppend = canSensitiveWrite && appendInput.trim() !== '' && !isMutating

  const handleAppend = () => {
    if (!canAppend) return
    actionMutation.mutate({ action: 'add', keys: [appendInput] })
  }

  const renderStatus = (key: KeyStatus) => {
    const config = getMultiKeyStatusConfig(key.status)
    return (
      <div className='flex flex-col gap-0.5'>
        <StatusBadge
          label={t(config.label)}
          variant={config.variant}
          showDot
          copyable={false}
        />
        {key.status !== MULTI_KEY_STATUS.ENABLED && key.reason && (
          <span className='text-muted-foreground text-xs'>{key.reason}</span>
        )}
      </div>
    )
  }

  return (
    <>
      <div className='space-y-3 rounded-lg border p-3'>
        <div className='flex items-start justify-between gap-2'>
          <div className='space-y-0.5'>
            <p className='text-sm font-medium'>{t('Multi-Key Management')}</p>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Keys are always shown masked. Append new keys here, or enable / disable / delete a single key.'
              )}
            </p>
          </div>
          <TooltipProvider delay={100}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Refresh')}
                    disabled={statusQuery.isFetching}
                    onClick={() => void statusQuery.refetch()}
                  />
                }
              >
                {statusQuery.isFetching ? (
                  <Loader2 className='size-3.5 animate-spin' />
                ) : (
                  <RefreshCw className='size-3.5' />
                )}
              </TooltipTrigger>
              <TooltipContent>{t('Refresh')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className='space-y-2'>
          <Textarea
            rows={2}
            value={appendInput}
            disabled={!canSensitiveWrite}
            onChange={(event) => setAppendInput(event.target.value)}
            placeholder={t('Paste one key per line to append')}
            className='font-mono text-xs'
          />
          <div className='flex items-center justify-between gap-2'>
            <p className='text-muted-foreground text-xs'>
              {t(
                'New keys are appended to the end of the list; keys already present are skipped.'
              )}
            </p>
            <Button size='sm' disabled={!canAppend} onClick={handleAppend}>
              {isMutating ? (
                <Loader2 className='mr-1 size-3.5 animate-spin' />
              ) : (
                <Plus className='mr-1 size-3.5' />
              )}
              {t('Append keys')}
            </Button>
          </div>
        </div>

        <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'>
          <span>{t('{{count}} keys in total', { count: total })}</span>
          <span>·</span>
          <span>
            {t('Enabled')} {statusQuery.data?.enabled_count ?? 0}
          </span>
          <span>·</span>
          <span>
            {t('Manual Disabled')} {statusQuery.data?.manual_disabled_count ?? 0}
          </span>
          <span>·</span>
          <span>
            {t('Auto Disabled')} {statusQuery.data?.auto_disabled_count ?? 0}
          </span>
        </div>

        {statusQuery.isPending ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='text-muted-foreground size-5 animate-spin' />
          </div>
        ) : (
          <StaticDataTable
            className='rounded-md border'
            tableClassName='min-w-[420px]'
            data={keys}
            getRowKey={(key) => key.index}
            empty={keys.length === 0}
            emptyContent={t('No keys found')}
            columns={[
              {
                id: 'index',
                header: t('Index'),
                className: 'w-12',
                cellClassName: 'font-mono text-xs',
                cell: (key) => `#${key.index + 1}`,
              },
              {
                id: 'key',
                header: t('Key'),
                cellClassName: 'max-w-[220px] truncate font-mono text-xs',
                cell: (key) => key.key_preview || '-',
              },
              {
                id: 'status',
                header: t('Status'),
                className: 'w-32',
                cell: (key) => renderStatus(key),
              },
              {
                id: 'actions',
                header: t('Actions'),
                className: 'w-20 text-right',
                cell: (key) => (
                  <div className='flex justify-end gap-1'>
                    <TooltipProvider delay={100}>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant='ghost'
                              size='icon-sm'
                              disabled={isMutating}
                              aria-label={
                                key.status === MULTI_KEY_STATUS.ENABLED
                                  ? t('Disable')
                                  : t('Enable')
                              }
                              onClick={() =>
                                actionMutation.mutate({
                                  action:
                                    key.status === MULTI_KEY_STATUS.ENABLED
                                      ? 'disable'
                                      : 'enable',
                                  keyIndex: key.index,
                                })
                              }
                            />
                          }
                        >
                          {key.status === MULTI_KEY_STATUS.ENABLED ? (
                            <PowerOff className='size-3.5' />
                          ) : (
                            <Power className='size-3.5' />
                          )}
                        </TooltipTrigger>
                        <TooltipContent>
                          {key.status === MULTI_KEY_STATUS.ENABLED
                            ? t('Disable')
                            : t('Enable')}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant='ghost'
                              size='icon-sm'
                              aria-label={t('Delete')}
                              disabled={!canSensitiveWrite || isMutating}
                              onClick={() => setDeleteTarget(key)}
                            />
                          }
                        >
                          <Trash2 className='size-3.5' />
                        </TooltipTrigger>
                        <TooltipContent>
                          {canSensitiveWrite
                            ? t('Delete')
                            : t('No permission to perform this action')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                ),
              },
            ]}
          />
        )}

        {totalPages > 1 && (
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-xs'>
              {t('Page {{current}} of {{total}}', {
                current: statusQuery.data?.page ?? page,
                total: totalPages,
              })}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1 || statusQuery.isFetching}
                onClick={() => setPage(page - 1)}
              >
                {t('Previous')}
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= totalPages || statusQuery.isFetching}
                onClick={() => setPage(page + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        )}

        {!canSensitiveWrite && (
          <p className='text-muted-foreground text-xs'>
            {t('No permission to perform this action')}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('Confirm Action')}
        desc={t(MULTI_KEY_CONFIRM_MESSAGES.DELETE)}
        destructive
        isLoading={isMutating}
        handleConfirm={() => {
          if (!deleteTarget) return
          actionMutation.mutate({
            action: 'delete',
            keyIndex: deleteTarget.index,
          })
        }}
      />
    </>
  )
}
