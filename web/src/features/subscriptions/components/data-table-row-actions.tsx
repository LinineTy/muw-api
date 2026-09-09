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
import { Pencil, Power, PowerOff, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { PlanRecord } from '../types'
import { useSubscriptions } from './subscriptions-provider'

interface DataTableRowActionsProps {
  plan: PlanRecord
}

export function DataTableRowActions({ plan }: DataTableRowActionsProps) {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow } = useSubscriptions()
  const isEnabled = plan.plan.enabled
  const toggleLabel = isEnabled ? t('Disable') : t('Enable')
  // 固定分组商品没有订阅，也就没有可重置的额度。
  const isGroupPin = plan.kind === 'group_pin'

  const handleEdit = () => {
    setCurrentRow(plan)
    setOpen('update')
  }

  const handleToggleStatus = () => {
    setCurrentRow(plan)
    setOpen('toggle-status')
  }

  const handleResetSubscriptions = () => {
    setCurrentRow(plan)
    setOpen('reset-subscriptions')
  }

  const handleDelete = () => {
    setCurrentRow(plan)
    setOpen('delete')
  }

  return (
    <div className='-ml-1.5 flex items-center gap-1'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={handleEdit}
              aria-label={t('Edit')}
            />
          }
        >
          <Pencil />
        </TooltipTrigger>
        <TooltipContent>{t('Edit')}</TooltipContent>
      </Tooltip>

      {!isGroupPin && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={handleResetSubscriptions}
                aria-label={t('Reset subscription quota')}
              />
            }
          >
            <RotateCcw />
          </TooltipTrigger>
          <TooltipContent>{t('Reset subscription quota')}</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={handleToggleStatus}
              aria-label={toggleLabel}
              className={
                isEnabled
                  ? 'text-destructive hover:text-destructive'
                  : 'text-success hover:text-success'
              }
            />
          }
        >
          {isEnabled ? <PowerOff /> : <Power />}
        </TooltipTrigger>
        <TooltipContent>{toggleLabel}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={handleDelete}
              aria-label={t('Delete')}
              className='text-destructive hover:text-destructive'
            />
          }
        >
          <Trash2 />
        </TooltipTrigger>
        <TooltipContent>{t('Delete')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
