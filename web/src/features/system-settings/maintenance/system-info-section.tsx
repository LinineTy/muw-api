// @muw-owned
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Progress } from '@/components/ui/progress'
import { api } from '@/lib/api'

import { formatBytes } from './performance-section'

type SystemInfoStats = {
  system_status?: {
    cpu_usage?: number
    memory_usage?: number
    memory_total?: number
    memory_used?: number
    disk_usage?: number
  }
  system_info?: {
    os?: string
    arch?: string
    go_version?: string
    num_cpu?: number
    hostname?: string
    is_container?: boolean
  }
  disk_space_info?: {
    total?: number
    used?: number
    used_percent?: number
  }
}

function roundPercent(value?: number): number {
  if (value === undefined || Number.isNaN(value)) return 0
  return Math.round(value)
}

export function SystemInfoSection() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<SystemInfoStats | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await api.get('/api/performance/stats')
        if (active && res.data.success) setStats(res.data.data)
      } catch {
        /* 非 root 管理员或接口失败时静默 */
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const status = stats?.system_status
  const info = stats?.system_info
  const disk = stats?.disk_space_info

  let memoryPercent = 0
  if (status?.memory_total && status.memory_total > 0) {
    memoryPercent = Math.round(
      ((status.memory_used ?? 0) / status.memory_total) * 100
    )
  } else if (status?.memory_usage !== undefined) {
    memoryPercent = roundPercent(status.memory_usage)
  }
  const diskPercent =
    disk?.used_percent !== undefined
      ? Math.round(disk.used_percent)
      : roundPercent(status?.disk_usage)

  return (
    <div className='space-y-4'>
      {!stats ? (
        <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
      ) : (
        <>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
            <div className='rounded-lg border p-4'>
              <p className='text-sm font-medium'>{t('CPU Usage')}</p>
              <Progress value={roundPercent(status?.cpu_usage)} className='mt-2' />
              <p className='text-muted-foreground mt-2 text-xs tabular-nums'>
                {roundPercent(status?.cpu_usage)}%
              </p>
            </div>
            <div className='rounded-lg border p-4'>
              <p className='text-sm font-medium'>{t('Memory Usage')}</p>
              <Progress value={memoryPercent} className='mt-2' />
              <p className='text-muted-foreground mt-2 flex justify-between text-xs tabular-nums'>
                <span>{memoryPercent}%</span>
                <span>
                  {t('Used')} {formatBytes(status?.memory_used ?? 0)} /{' '}
                  {t('Total')} {formatBytes(status?.memory_total ?? 0)}
                </span>
              </p>
            </div>
            <div className='rounded-lg border p-4'>
              <p className='text-sm font-medium'>{t('Disk Usage')}</p>
              <Progress value={diskPercent} className='mt-2' />
              <p className='text-muted-foreground mt-2 flex justify-between text-xs tabular-nums'>
                <span>{diskPercent}%</span>
                <span>
                  {t('Used')} {formatBytes(disk?.used ?? 0)} / {t('Total')}{' '}
                  {formatBytes(disk?.total ?? 0)}
                </span>
              </p>
            </div>
          </div>

          <div className='rounded-lg border p-4'>
            <p className='mb-3 text-sm font-medium'>
              {t('System Information')}
            </p>
            <div className='grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-3'>
              <div className='min-w-0'>
                <span className='text-muted-foreground'>
                  {t('Operating System')}:
                </span>{' '}
                <span className='break-words'>{info?.os || t('Unknown')}</span>
              </div>
              <div className='min-w-0'>
                <span className='text-muted-foreground'>
                  {t('Architecture')}:
                </span>{' '}
                <span className='break-words'>
                  {info?.arch || t('Unknown')}
                </span>
              </div>
              <div className='min-w-0'>
                <span className='text-muted-foreground'>
                  {t('CPU Cores')}:
                </span>{' '}
                <span className='break-words'>{info?.num_cpu ?? t('Unknown')}</span>
              </div>
              <div className='min-w-0'>
                <span className='text-muted-foreground'>
                  {t('Go Version')}:
                </span>{' '}
                <span className='break-words'>
                  {info?.go_version || t('Unknown')}
                </span>
              </div>
              <div className='min-w-0'>
                <span className='text-muted-foreground'>{t('Hostname')}:</span>{' '}
                <span className='break-words'>
                  {info?.hostname || t('Unknown')}
                </span>
              </div>
              <div className='min-w-0'>
                <span className='text-muted-foreground'>
                  {t('Running in Container')}:
                </span>{' '}
                <span className='break-words'>
                  {info?.is_container ? t('Yes') : t('No')}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
