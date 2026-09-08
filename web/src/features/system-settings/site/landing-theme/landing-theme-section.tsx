// @muw-owned
import { HelpCircle, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import defaultThemePreview from '@/assets/default-theme.webp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { SettingsPageActionsPortal } from '../../components/settings-page-context'
import { SettingsSection } from '../../components/settings-section'
import { ImportThemeDialog } from './components/import-theme-dialog'
import { ManualThemeEditorDialog } from './components/manual-theme-editor-dialog'
import { ThemeCard } from './components/theme-card'
import { ThemeHelpDialog } from './components/theme-help-dialog'
import {
  useLandingThemes,
  useSelectLandingTheme,
} from './hooks/use-landing-themes'
import type { LandingManual, LandingThemeSummary } from './types'

const ALL_PAGE_FILTERS = [
  { value: 'all', labelKey: 'All Pages' },
  { value: 'home', labelKey: 'Home' },
  { value: 'about', labelKey: 'About' },
  { value: 'user_agreement', labelKey: 'User Agreement' },
  { value: 'privacy_policy', labelKey: 'Privacy Policy' },
]

// 默认主题 = 内置 React 营销页 + About/用户协议/隐私政策四页。
const DEFAULT_THEME_PAGES = [
  'home',
  'about',
  'user_agreement',
  'privacy_policy',
]

const EMPTY_THEMES: LandingThemeSummary[] = []
const EMPTY_MANUAL: LandingManual = {
  home: '',
  about: '',
  user_agreement: '',
  privacy_policy: '',
}

function manualPagesOf(manual: LandingManual): string[] {
  return (['home', 'about', 'user_agreement', 'privacy_policy'] as const)
    .filter((key) => manual[key] !== '')
    .map(String)
}

export function LandingPageThemeSection() {
  const { t } = useTranslation()
  const { data, isLoading } = useLandingThemes()
  const selectTheme = useSelectLandingTheme()

  const [query, setQuery] = useState('')
  const [filterPage, setFilterPage] = useState('all')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showManualEditor, setShowManualEditor] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const themes = data?.themes ?? EMPTY_THEMES
  const selected = data?.selected ?? 'default'
  const manual = data?.manual ?? EMPTY_MANUAL

  const manualPages = useMemo(() => manualPagesOf(manual), [manual])

  const handleSelect = (id: string) => {
    if (id !== selected) {
      selectTheme.mutate(id)
    }
  }

  // 搜索 + 筛选:按名称匹配,按覆盖页面类型过滤
  const filteredThemes = useMemo(() => {
    const q = query.trim().toLowerCase()
    return themes.filter((theme) => {
      if (filterPage !== 'all' && !theme.pages.includes(filterPage)) {
        return false
      }
      if (q && !theme.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [themes, query, filterPage])

  const defaultVisible =
    (filterPage === 'all' || filterPage === '') &&
    (!query || t('Default Theme').toLowerCase().includes(query.toLowerCase()))
  const manualVisible =
    (filterPage === 'all' || manualPages.includes(filterPage)) &&
    (!query ||
      t('Manual Configuration').toLowerCase().includes(query.toLowerCase()))

  return (
    <SettingsSection title={t('Theme Configuration')}>
      <SettingsPageActionsPortal>
        <Button
          type='button'
          size='sm'
          onClick={() => setShowImportDialog(true)}
        >
          <Upload
            data-icon='inline-start'
            className='size-4'
            aria-hidden='true'
          />
          {t('Import Theme')}
        </Button>
      </SettingsPageActionsPortal>

      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
        <p className='text-muted-foreground -mt-1 text-sm'>
          {t(
            'A theme can cover the Home, About, User Agreement and Privacy Policy pages.'
          )}
        </p>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='-mt-1 h-auto p-0 text-xs font-medium'
          onClick={() => setShowHelp(true)}
        >
          <HelpCircle
            data-icon='inline-start'
            className='size-3.5'
            aria-hidden='true'
          />
          {t('How to make a theme')}
        </Button>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Search themes')}
          className='h-8 w-44'
        />
        <Select
          value={filterPage}
          onValueChange={(value) => value !== null && setFilterPage(value)}
        >
          <SelectTrigger className='w-40' aria-label={t('Filter by page')}>
            <SelectValue>
              {t(
                ALL_PAGE_FILTERS.find((filter) => filter.value === filterPage)
                  ?.labelKey ?? ''
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {ALL_PAGE_FILTERS.map((filter) => (
              <SelectItem key={filter.value} value={filter.value}>
                {t(filter.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className='h-64 w-full rounded-lg' />
          ))}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {defaultVisible && (
            <ThemeCard
              name={t('Default Theme')}
              selected={selected === 'default'}
              preview={defaultThemePreview}
              pages={DEFAULT_THEME_PAGES}
              onSelect={() => handleSelect('default')}
            />
          )}

          {manualVisible && (
            <ThemeCard
              name={t('Manual Configuration')}
              selected={selected === 'manual'}
              pages={manualPages}
              onSelect={() => handleSelect('manual')}
              onEdit={() => setShowManualEditor(true)}
            />
          )}

          {filteredThemes.map((theme) => (
            <ThemeCard
              key={theme.id}
              name={theme.name}
              selected={selected === theme.id}
              pages={theme.pages}
              preview={theme.preview}
              version={theme.version}
              previewId={theme.id}
              onSelect={() => handleSelect(theme.id)}
            />
          ))}

          {!isLoading &&
            !defaultVisible &&
            !manualVisible &&
            filteredThemes.length === 0 && (
              <p className='text-muted-foreground text-xs'>
                {t('No themes match your search.')}
              </p>
            )}
        </div>
      )}

      <ImportThemeDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
      />
      <ManualThemeEditorDialog
        open={showManualEditor}
        initial={manual}
        onOpenChange={setShowManualEditor}
      />
      <ThemeHelpDialog open={showHelp} onOpenChange={setShowHelp} />
    </SettingsSection>
  )
}
