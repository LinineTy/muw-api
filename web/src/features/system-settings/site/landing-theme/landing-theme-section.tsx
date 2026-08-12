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
import { Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { SettingsSection } from '../../components/settings-section'
import { ImportThemeDialog } from './components/import-theme-dialog'
import { ThemeCard } from './components/theme-card'
import { ThemePreviewDialog } from './components/theme-preview-dialog'
import {
  useLandingThemes,
  useSelectLandingTheme,
} from './hooks/use-landing-themes'
import type { LandingThemeSummary } from './types'

export function LandingPageThemeSection() {
  const { t } = useTranslation()
  const { data, isLoading } = useLandingThemes()
  const selectTheme = useSelectLandingTheme()

  const [showImportDialog, setShowImportDialog] = useState(false)
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null)

  const themes = data?.themes ?? []
  const selected = data?.selected ?? 'default'

  const handleSelect = (id: string) => {
    if (id !== selected) {
      selectTheme.mutate(id)
    }
  }

  return (
    <SettingsSection title={t('Landing Page Theme')}>
      <p className='text-muted-foreground -mt-1 text-sm'>
        {t(
          'Choose a landing page theme. Imported HTML is shown in an isolated frame and rendered as-is for visitors.'
        )}
      </p>

      {isLoading ? (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className='h-28 w-full rounded-lg' />
          ))}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {/* 内置默认主题:恢复硬编码 React 营销页 */}
          <Card
            className={cn(
              'transition-colors',
              selected === 'default' && 'border-primary/60 ring-primary/20 ring-1'
            )}
          >
            <CardContent className='flex h-full flex-col gap-3 p-4'>
              <div className='flex items-start justify-between gap-2'>
                <div className='flex min-w-0 items-center gap-2'>
                  <Sparkles className='text-muted-foreground size-4 shrink-0' aria-hidden='true' />
                  <p className='truncate text-sm font-medium'>
                    {t('Default Theme')}
                  </p>
                </div>
                {selected === 'default' && <Badge>{t('Active')}</Badge>}
              </div>
              <p className='text-muted-foreground text-xs'>
                {t('The built-in landing page with hero, features, and stats')}
              </p>
              <div className='mt-auto'>
                <Button
                  variant={selected === 'default' ? 'secondary' : 'outline'}
                  size='sm'
                  disabled={selected === 'default'}
                  onClick={() => handleSelect('default')}
                >
                  {selected === 'default' ? t('Selected') : t('Select')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 导入新主题入口 */}
          <button
            type='button'
            className='border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/40 flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border bg-transparent text-sm transition-colors'
            onClick={() => setShowImportDialog(true)}
          >
            <Plus className='size-5' aria-hidden='true' />
            {t('Import Theme')}
          </button>

          {themes.map((theme: LandingThemeSummary) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={selected === theme.id}
              onSelect={() => handleSelect(theme.id)}
              onPreview={() => setPreviewThemeId(theme.id)}
            />
          ))}

          {themes.length === 0 && (
            <p className='text-muted-foreground text-xs'>
              {t('No imported themes yet.')}
            </p>
          )}
        </div>
      )}

      <ImportThemeDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
      />
      <ThemePreviewDialog
        themeId={previewThemeId}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewThemeId(null)
          }
        }}
      />
    </SettingsSection>
  )
}
