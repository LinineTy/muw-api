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
import { DescriptionDialog } from './dialogs/description-dialog'
import { MissingModelsDialog } from './dialogs/missing-models-dialog'
import { PrefillGroupManagement } from './dialogs/prefill-group-management'
import { PriceSyncDialog } from './dialogs/price-sync-dialog'
import { SyncWizardDialog } from './dialogs/sync-wizard-dialog'
import { UpstreamConflictDialog } from './dialogs/upstream-conflict-dialog'
import { ModelMutateDrawer } from './drawers/model-mutate-drawer'
import { useModels } from './models-provider'
import { VendorManagement } from './vendor-management'

export function ModelsDialogs() {
  const { open, setOpen, currentRow, descriptionData, setDescriptionData } =
    useModels()

  return (
    <>
      <PriceSyncDialog
        open={open === 'price-sync'}
        onOpenChange={(value) => !value && setOpen(null)}
      />

      {/* Model Create/Update Drawer（含 pricing 表单字段） */}
      {/* MERGE-DECISION: 保留 fork 抽屉；price-model 同样打开它（fork 抽屉无上游 initialSection 分区）。 */}
      <ModelMutateDrawer
        open={
          open === 'create-model' ||
          open === 'update-model' ||
          open === 'price-model'
        }
        onOpenChange={(v) => !v && setOpen(null)}
        currentRow={currentRow}
      />

      {/* Vendor Management（fork 自研：列表 + 编辑表单一体） */}
      <VendorManagement
        open={open === 'vendor-management'}
        onOpenChange={(v) => !v && setOpen(null)}
      />

      {/* Missing Models Dialog */}
      <MissingModelsDialog
        open={open === 'missing-models'}
        onOpenChange={(v) => !v && setOpen(null)}
      />

      {/* Sync Wizard Dialog */}
      <SyncWizardDialog
        open={open === 'sync-wizard'}
        onOpenChange={(v) => !v && setOpen(null)}
      />

      {/* Upstream Conflict Dialog */}
      <UpstreamConflictDialog
        open={open === 'upstream-conflict'}
        onOpenChange={(v) => !v && setOpen(null)}
      />

      {/* Prefill Groups Management */}
      <PrefillGroupManagement
        open={open === 'prefill-groups'}
        onOpenChange={(v) => !v && setOpen(null)}
      />

      {/* Description Dialog */}
      <DescriptionDialog
        open={open === 'description'}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(null)
            setDescriptionData(null)
          }
        }}
        modelName={descriptionData?.modelName || ''}
        description={descriptionData?.description || ''}
      />
    </>
  )
}
