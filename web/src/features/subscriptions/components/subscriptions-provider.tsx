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
import React, { useState } from 'react'

import useDialogState from '@/hooks/use-dialog'

import type { PlanKind, PlanRecord, SubscriptionsDialogType } from '../types'

type SubscriptionsContextType = {
  open: SubscriptionsDialogType | null
  setOpen: (str: SubscriptionsDialogType | null) => void
  currentRow: PlanRecord | null
  setCurrentRow: React.Dispatch<React.SetStateAction<PlanRecord | null>>
  /** 新建对象的类型（套餐 / 固定分组商品）；编辑时以 currentRow.kind 为准。 */
  createKind: PlanKind
  setCreateKind: (kind: PlanKind) => void
  refreshTrigger: number
  triggerRefresh: () => void
  grouped: boolean
  setGrouped: (value: boolean) => void
}

const SubscriptionsContext =
  React.createContext<SubscriptionsContextType | null>(null)

export function SubscriptionsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useDialogState<SubscriptionsDialogType>(null)
  const [currentRow, setCurrentRow] = useState<PlanRecord | null>(null)
  const [createKind, setCreateKind] = useState<PlanKind>('plan')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [grouped, setGrouped] = useState(() => {
    return localStorage.getItem('subscriptions:grouped') === 'true'
  })

  const triggerRefresh = () => setRefreshTrigger((prev) => prev + 1)

  return (
    <SubscriptionsContext
      value={{
        open,
        setOpen,
        currentRow,
        setCurrentRow,
        createKind,
        setCreateKind,
        refreshTrigger,
        triggerRefresh,
        grouped,
        setGrouped,
      }}
    >
      {children}
    </SubscriptionsContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSubscriptions = () => {
  const ctx = React.useContext(SubscriptionsContext)
  if (!ctx) {
    throw new Error(
      'useSubscriptions has to be used within <SubscriptionsProvider>'
    )
  }
  return ctx
}
