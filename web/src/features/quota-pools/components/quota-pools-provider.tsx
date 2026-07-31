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

import { type QuotaPool, type QuotaPoolsDialogType } from '../types'

type QuotaPoolsContextType = {
  open: QuotaPoolsDialogType | null
  setOpen: (str: QuotaPoolsDialogType | null) => void
  currentRow: QuotaPool | null
  setCurrentRow: React.Dispatch<React.SetStateAction<QuotaPool | null>>
  refreshTrigger: number
  triggerRefresh: () => void
}

const QuotaPoolsContext = React.createContext<QuotaPoolsContextType | null>(
  null
)

export function QuotaPoolsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useDialogState<QuotaPoolsDialogType>(null)
  const [currentRow, setCurrentRow] = useState<QuotaPool | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const triggerRefresh = () => setRefreshTrigger((prev) => prev + 1)

  return (
    <QuotaPoolsContext
      value={{
        open,
        setOpen,
        currentRow,
        setCurrentRow,
        refreshTrigger,
        triggerRefresh,
      }}
    >
      {children}
    </QuotaPoolsContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useQuotaPools = () => {
  const ctx = React.useContext(QuotaPoolsContext)

  if (!ctx) {
    throw new Error('useQuotaPools has to be used within <QuotaPoolsProvider>')
  }

  return ctx
}
