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
import { RefreshCcwIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Markdown } from '@/components/ui/markdown'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatTimestamp } from '@/lib/format'

import { SettingsSection } from '../components/settings-section'

type UpdateCheckData = {
  has_update: boolean
  latest_tag: string
  current_version: string
  latest_changelog?: string
}

type UpdateCheckerSectionProps = {
  currentVersion?: string | null
  startTime?: number | null
}

type ChangelogData = {
  version: string
  matched: boolean
  note?: {
    version: string
    date?: string
    markdown: string
  }
}

export function UpdateCheckerSection({
  currentVersion,
  startTime,
}: UpdateCheckerSectionProps) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [latestTag, setLatestTag] = useState('')
  const [latestChangelog, setLatestChangelog] = useState('')
  const [serverVersion, setServerVersion] = useState('')
  const [changelog, setChangelog] = useState<ChangelogData | null>(null)

  const uptime = startTime ? formatTimestamp(startTime) : t('Unknown')
  const version = currentVersion || t('Unknown')

  // 更新日志随二进制内置，拿不到时静默降级（不影响版本号与检查更新）
  useEffect(() => {
    let cancelled = false
    api
      .get('/api/status/changelog')
      .then((res) => {
        const data = res.data?.data as ChangelogData | undefined
        if (!cancelled && res.data?.success && data?.note?.markdown) {
          setChangelog(data)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const handleCheckUpdates = async () => {
    setChecking(true)
    try {
      const res = await api.get('/api/status/update-check')
      const data = res.data?.data as UpdateCheckData | undefined
      if (!res.data?.success || !data) {
        throw new Error(res.data?.message || t('Failed to check for updates'))
      }

      if (!data.has_update) {
        toast.success(
          t('You are running the latest version ({{version}}).', {
            version: data.current_version || version,
          })
        )
        return
      }

      setLatestTag(data.latest_tag)
      setLatestChangelog(data.latest_changelog || '')
      setServerVersion(data.current_version)
      setDialogOpen(true)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('Failed to check for updates')
      toast.error(message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <SettingsSection title={t('System maintenance')}>
        <div className='space-y-6'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='rounded-lg border p-4'>
              <div className='text-muted-foreground text-sm'>
                {t('Current version')}
              </div>
              <div className='text-lg font-semibold'>{version}</div>
            </div>
            <div className='rounded-lg border p-4'>
              <div className='text-muted-foreground text-sm'>
                {t('Uptime since')}
              </div>
              <div className='text-lg font-semibold'>{uptime}</div>
            </div>
          </div>

          <Button onClick={handleCheckUpdates} disabled={checking}>
            {checking ? (
              t('Checking updates...')
            ) : (
              <>
                <RefreshCcwIcon className='me-2 h-4 w-4' />
                {t('Check for updates')}
              </>
            )}
          </Button>

          {changelog?.note?.markdown && (
            <div className='rounded-lg border p-4'>
              <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
                <div className='text-sm font-medium'>
                  {t('Release notes for this version')}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {changelog.note.version}
                  {changelog.note.date ? ` · ${changelog.note.date}` : ''}
                </div>
              </div>
              {!changelog.matched && (
                <div className='text-muted-foreground mt-1 text-xs'>
                  {t(
                    'No release notes for the running version, showing the latest release'
                  )}
                </div>
              )}
              <Markdown className='mt-3'>{changelog.note.markdown}</Markdown>
            </div>
          )}
        </div>
      </SettingsSection>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          latestTag
            ? t('New version available: {{version}}', { version: latestTag })
            : t('Release details')
        }
        footer={
          <Button type='button' onClick={() => setDialogOpen(false)}>
            {t('Close')}
          </Button>
        }
      >
        <div className='space-y-2 text-sm'>
          <p>
            {t('Current version')}: {serverVersion || version}
          </p>
          <p className='font-medium'>
            {t('Latest version')}: {latestTag}
          </p>
          <p className='text-muted-foreground'>
            {t('Update from the official registry.')}
          </p>
          {latestChangelog && (
            <div className='border-t pt-2'>
              <div className='mb-1 font-medium'>
                {t('What is new in this version')}
              </div>
              <Markdown className='max-h-64 overflow-y-auto'>
                {latestChangelog}
              </Markdown>
            </div>
          )}
        </div>
      </Dialog>
    </>
  )
}
