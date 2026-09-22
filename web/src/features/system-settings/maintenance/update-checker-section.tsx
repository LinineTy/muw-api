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
import { ChevronDownIcon, RefreshCcwIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Markdown } from '@/components/ui/markdown'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { api } from '@/lib/api'
import { formatTimestamp } from '@/lib/format'
import { formatVersionLabel } from '@/lib/version-label'
import { cn } from '@/lib/utils'

import { SettingsPageActionsPortal } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSystemOptions } from '../hooks/use-system-options'
import { useUpdateOption } from '../hooks/use-update-option'

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

type ChangelogHistoryEntry = {
  version: string
  date?: string
  markdown: string
}

type ChangelogData = {
  version: string
  matched: boolean
  note?: {
    version: string
    date?: string
    markdown: string
  }
  history?: ChangelogHistoryEntry[]
}

function ChangelogHistoryRow({ entry }: { entry: ChangelogHistoryEntry }) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='rounded-md border'
    >
      <CollapsibleTrigger
        render={
          <button
            type='button'
            className='hover:bg-muted/40 flex w-full items-center justify-between gap-x-3 rounded-md px-3 py-2 text-left transition-colors'
            aria-expanded={open}
          />
        }
      >
        {/* 历史条目保留原始 tag：老版本的 muw.N 是连号记法，按"当天第几个"美化会误导 */}
        <span className='text-[13px] font-medium'>{entry.version}</span>
        <span className='flex items-center gap-2'>
          {entry.date && (
            <span className='text-muted-foreground text-xs'>{entry.date}</span>
          )}
          <ChevronDownIcon
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              open && 'rotate-180'
            )}
            aria-hidden='true'
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className='border-t px-3 py-2'>
        <Markdown>{entry.markdown}</Markdown>
      </CollapsibleContent>
    </Collapsible>
  )
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
  const [historyOpen, setHistoryOpen] = useState(false)

  // 是否连"未标记稳定"的开发版一起检测（默认关：只看对外公告的稳定版）。
  const { data: optionsData } = useSystemOptions()
  const updateOption = useUpdateOption()
  // 选项接口在异常/被 mock 的情况下不一定给数组，这里先兜一层再查（避免 .find 抛错把整节炸掉）
  const options = Array.isArray(optionsData?.data) ? optionsData.data : []
  const devChannelEnabled =
    String(
      options.find((option) => option.key === 'UpdateCheckDevChannelEnabled')
        ?.value ?? ''
    ) === 'true'

  const uptime = startTime ? formatTimestamp(startTime) : t('Unknown')
  // 后端返回的原始版本号：只做兜底与 title 提示，版本比较逻辑不受展示美化影响
  const rawVersion = currentVersion?.trim() ?? ''
  const version = rawVersion || t('Unknown')
  const versionLabel = formatVersionLabel(rawVersion, t) || version

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
            version:
              formatVersionLabel(data.current_version || rawVersion, t) ||
              version,
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
              <div
                className='text-lg font-semibold'
                title={rawVersion || undefined}
              >
                {versionLabel}
              </div>
            </div>
            <div className='rounded-lg border p-4'>
              <div className='text-muted-foreground text-sm'>
                {t('Uptime since')}
              </div>
              <div className='text-lg font-semibold'>{uptime}</div>
            </div>
          </div>

          {/* 通道开关：默认只比非 prerelease 的稳定版 release；打开后连开发版（prerelease）一起比 */}
          <div className='rounded-lg border p-4'>
            <div className='flex items-center justify-between gap-4'>
              <div className='space-y-1'>
                <div className='text-sm font-medium'>
                  {t('Check for development builds')}
                </div>
                <div className='text-muted-foreground text-sm'>
                  {t(
                    'When enabled, update checks use the latest development build instead of the marked stable release.'
                  )}
                </div>
              </div>
              <Switch
                checked={devChannelEnabled}
                disabled={updateOption.isPending}
                onCheckedChange={(checked) =>
                  updateOption.mutate({
                    key: 'UpdateCheckDevChannelEnabled',
                    value: checked,
                  })
                }
              />
            </div>
          </div>

          {/* 与其它设置页一致：更新入口作为页面级操作放到右上角，避免与下方「检查更新」按钮文案相撞 */}
          {/* 与其它设置页一致：更新操作统一放右上角。
              只用我们自己的更新源（/api/status/update-check → 公网 Gitea releases，
              后端代查后返回），不引入前端直连上游 GitHub releases 的入口。 */}
          <SettingsPageActionsPortal>
            <Button
              type='button'
              size='sm'
              variant='default'
              onClick={handleCheckUpdates}
              disabled={checking}
            >
              <RefreshCcwIcon className={cn('me-2 size-4', checking && 'animate-spin')} />
              {checking ? t('Checking updates...') : t('Check for updates')}
            </Button>
          </SettingsPageActionsPortal>

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

          {changelog?.history && changelog.history.length > 0 && (
            <div className='rounded-lg border p-4'>
              <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                <CollapsibleTrigger
                  render={
                    <button
                      type='button'
                      className='flex w-full items-center justify-between gap-x-3 text-left'
                      aria-expanded={historyOpen}
                    />
                  }
                >
                  <span className='text-sm font-medium'>
                    {t('Previous versions')}
                  </span>
                  <span className='flex items-center gap-2'>
                    <span className='text-muted-foreground text-xs'>
                      {changelog.history.length}
                    </span>
                    <ChevronDownIcon
                      className={cn(
                        'h-4 w-4 transition-transform',
                        historyOpen && 'rotate-180'
                      )}
                      aria-hidden='true'
                    />
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className='mt-3 flex flex-col gap-2'>
                  {changelog.history.map((item) => (
                    <ChangelogHistoryRow key={item.version} entry={item} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </SettingsSection>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          latestTag
            ? t('New version available: {{version}}', {
                version: formatVersionLabel(latestTag, t) || latestTag,
              })
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
            {t('Current version')}:{' '}
            {formatVersionLabel(serverVersion || rawVersion, t) || version}
          </p>
          <p className='font-medium'>
            {t('Latest version')}:{' '}
            {formatVersionLabel(latestTag, t) || latestTag}
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
