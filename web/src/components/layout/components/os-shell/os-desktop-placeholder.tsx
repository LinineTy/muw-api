// @muw-owned
import { useTranslation } from 'react-i18next'

import { SystemBrand } from '../system-brand'
import { useOsShellNavigate } from './os-open'
import { useOsNavGroups } from './use-os-nav'

/**
 * OS 桌面壳 · 空桌面态:
 * 窗口被关闭(红点)后显示品牌+提示,并按导航分组展示快速导航
 * (PC 大屏横向铺开各组;点击开窗,设置页走主层完整布局)。
 */
export function OsDesktopPlaceholder() {
  const { t } = useTranslation()
  const groups = useOsNavGroups()
  const osNavigate = useOsShellNavigate()

  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto p-6'>
      <div className='opacity-80'>
        <SystemBrand variant='inline' />
      </div>
      <p className='text-muted-foreground/70 max-w-xs text-center text-sm'>
        {t('os-shell.desktop-hint')}
      </p>
      {groups.length > 0 ? (
        <div className='flex w-full max-w-5xl flex-wrap items-start justify-center gap-x-12 gap-y-8'>
          {groups.map((group) => (
            <div key={group.id} className='flex min-w-36 flex-col gap-2'>
              <div className='text-muted-foreground/70 border-border/40 mb-1 border-b pb-1.5 text-center text-[0.68rem] font-medium tracking-wide'>
                {group.title}
              </div>
              <div className='flex flex-col gap-1'>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.url}
                      type='button'
                      onClick={() => osNavigate(item.url)}
                      title={item.title}
                      className='text-foreground/80 hover:bg-popover/40 hover:text-foreground flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors'
                    >
                      {Icon ? (
                        <Icon className='size-4 shrink-0' aria-hidden='true' />
                      ) : null}
                      <span className='truncate'>{item.title}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
