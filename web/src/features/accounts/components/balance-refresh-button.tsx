// @muw-owned
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatCurrencyUSD } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { updateAccountBalance } from '../api'
import type { Account } from '../types'

/**
 * 「更新余额」按钮：调上游查该账户余额并落库到 accounts 表。
 *
 * 余额归账户（多渠道共享一份），所以刷新后失效的是账户列表缓存。
 * 交互与渠道侧同款（渠道列表的更新余额按钮）：成功 toast 带上新余额。
 */
export function BalanceRefreshButton({ account }: { account: Account }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isUpdating, setIsUpdating] = useState(false)

  const handleUpdate = async () => {
    if (isUpdating) return
    setIsUpdating(true)
    try {
      const response = await updateAccountBalance(account.id)
      // 业务失败（上游不支持余额查询的账户类型等）也是 HTTP 200 + success:false，
      // 此时没有 data —— 必须判 success 再取值，否则弹的是 JS TypeError 而不是原因。
      if (response.success && response.data?.balance !== undefined) {
        toast.success(
          t('Balance updated: {{balance}}', {
            balance: formatCurrencyUSD(response.data.balance),
          })
        )
        void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      } else {
        handleServerError(response, t('Failed to update balance'))
      }
    } catch (error: unknown) {
      handleServerError(error, t('Failed to update balance'))
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('Update Balance')}
              disabled={isUpdating}
              onClick={handleUpdate}
            />
          }
        >
          <RefreshCw className={cn('size-3.5', isUpdating && 'animate-spin')} />
        </TooltipTrigger>
        <TooltipContent>{t('Update Balance')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
