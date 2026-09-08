// @muw-owned
import { useTranslation } from 'react-i18next'

import { Progress } from '@/components/ui/progress'
import type { SystemLoad } from '../../hooks/use-system-load'

interface Props {
  load: SystemLoad
}

// 概览页系统负载：CPU / 内存占用率指示条。
export function SystemLoadIndicator({ load }: Props) {
  const { t } = useTranslation()
  const cpu = Math.round(load.cpu_usage ?? 0)
  const memory = Math.round(load.memory_usage ?? 0)

  return (
    <div className='flex w-full flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <span className='text-muted-foreground w-14 shrink-0 text-xs'>
          {t('CPU')}
        </span>
        <Progress value={cpu} className='h-1 flex-1' />
        <span className='w-10 shrink-0 text-right text-xs font-medium tabular-nums'>
          {cpu}%
        </span>
      </div>
      <div className='flex items-center gap-2'>
        <span className='text-muted-foreground w-14 shrink-0 text-xs'>
          {t('Memory')}
        </span>
        <Progress value={memory} className='h-1 flex-1' />
        <span className='w-10 shrink-0 text-right text-xs font-medium tabular-nums'>
          {memory}%
        </span>
      </div>
    </div>
  )
}
