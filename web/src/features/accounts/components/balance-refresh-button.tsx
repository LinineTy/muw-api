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
    setIsUpdating(true)
    try {
      const data = await updateAccountBalance(account.id)
      toast.success(
        t('Balance updated: {{balance}}', {
          balance: formatCurrencyUSD(data.balance),
        })
      )
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
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
