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
import { Layers, Pin, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MobileToggleMenu, ToggleMenuItem, TogglePill } from '@/components/ui/responsive-toggle'

import { useSubscriptions } from './subscriptions-provider'

export function SubscriptionsPrimaryButtons() {
  const { t } = useTranslation()
  const { setOpen, setCreateKind, grouped, setGrouped } = useSubscriptions()

  const handleGroupedToggle = (checked: boolean) => {
    localStorage.setItem('subscriptions:grouped', String(checked))
    setGrouped(checked)
  }

  // 新建入口按类型分开：类型在选择入口时确定，抽屉里不再切换（避免"点新建商品
  // 却落在套餐表单"）。
  const handleCreate = (kind: 'plan' | 'group_pin') => {
    setCreateKind(kind)
    setOpen('create')
  }

  return (
    <div className='flex items-center gap-2'>
      <TogglePill
        id='subscriptions-grouped'
        label={t('Group display')}
        icon={<Layers className='text-muted-foreground h-4 w-4' />}
        checked={grouped}
        onCheckedChange={handleGroupedToggle}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size='sm' />}
          aria-label={t('Create')}
        >
          <Plus className='h-4 w-4' />
          {t('Create')}
        </DropdownMenuTrigger>
        {/* 弹层默认取触发按钮宽度（w-(--anchor-width) + min-w-32），"新建"按钮太窄
            会把「固定分组商品」压到两行；改成按内容撑开、至少与按钮同宽。 */}
        <DropdownMenuContent
          align='end'
          className='w-fit min-w-(--anchor-width)'
        >
          <DropdownMenuItem onClick={() => handleCreate('plan')}>
            {t('Create Plan')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleCreate('group_pin')}>
            <Pin className='size-4' />
            {t('New Fixed Group Product')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MobileToggleMenu>
        <ToggleMenuItem
          label={t('Group display')}
          icon={<Layers className='size-4' />}
          checked={grouped}
          onCheckedChange={handleGroupedToggle}
        />
      </MobileToggleMenu>
    </div>
  )
}
