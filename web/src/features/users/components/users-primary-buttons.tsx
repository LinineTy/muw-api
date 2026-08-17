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
import { ListChecks, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { MobileToggleMenu, ToggleMenuItem, TogglePill } from '@/components/ui/responsive-toggle'

import { useUsers } from './users-provider'

export function UsersPrimaryButtons({
  batchMode,
  onBatchModeChange,
}: {
  batchMode: boolean
  onBatchModeChange: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow } = useUsers()

  const handleCreate = () => {
    setCurrentRow(null)
    setOpen('create')
  }

  return (
    <div className='flex items-center gap-2'>
      <TogglePill
        id='users-batch-mode'
        label={t('Batch Operations')}
        icon={<ListChecks className='text-muted-foreground h-4 w-4' />}
        checked={batchMode}
        onCheckedChange={onBatchModeChange}
      />
      <Button size='sm' onClick={handleCreate}>
        <Plus className='h-4 w-4' />
        {t('Add User')}
      </Button>
      <MobileToggleMenu>
        <ToggleMenuItem
          label={t('Batch Operations')}
          icon={<ListChecks className='size-4' />}
          checked={batchMode}
          onCheckedChange={onBatchModeChange}
        />
      </MobileToggleMenu>
    </div>
  )
}
