// @muw-owned
import { useEffect, useState } from 'react'

import type { Vendor } from '../types'
import { VendorManagementDialog } from './dialogs/vendor-management-dialog'
import { VendorMutateDialog } from './dialogs/vendor-mutate-dialog'

type VendorManagementProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type VendorView = 'dialog' | 'form'

export function VendorManagement({
  open,
  onOpenChange,
}: VendorManagementProps) {
  const [view, setView] = useState<VendorView>('dialog')
  const [currentVendor, setCurrentVendor] = useState<Vendor | null>(null)

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView('dialog')

      setCurrentVendor(null)
    }
  }, [open])

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setView('dialog')
      setCurrentVendor(null)
      onOpenChange(false)
    }
  }

  const handleFormClose = () => {
    setView('dialog')
    setCurrentVendor(null)
  }

  const handleShowForm = (vendor: Vendor | null) => {
    setCurrentVendor(vendor)
    setView('form')
  }

  return (
    <>
      <VendorManagementDialog
        open={open && view === 'dialog'}
        onOpenChange={handleDialogOpenChange}
        onCreateVendor={() => handleShowForm(null)}
        onEditVendor={(vendor) => handleShowForm(vendor)}
      />
      <VendorMutateDialog
        open={open && view === 'form'}
        onOpenChange={(v) => !v && handleFormClose()}
        currentVendor={currentVendor}
      />
    </>
  )
}
