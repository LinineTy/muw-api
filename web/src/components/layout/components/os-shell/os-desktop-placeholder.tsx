// @muw-owned
import { useTranslation } from 'react-i18next'

import { SystemBrand } from '../system-brand'
import { useOsShellNavigate } from './os-open'
import { useOsNavItems } from './use-os-nav'

/**
 * OS 桌面壳 · 空桌面态:
 * 窗口被关闭(红点)后显示品牌+提示,并提供快速导航网格
 * (顶层导航项,点击开窗;设置页走主层完整布局)。
 */
export function OsDesktopPlaceholder() {
  const { t } = useTranslation()
  const items = useOsNavItems()
  const osNavigate = useOsShellNavigate()

  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-6'>
      <div className='opacity-80'>
        <SystemBrand variant='inline' />
      </div>
      <p className='text-muted-foreground/70 max-w-xs text-center text-sm'>
        {t('os-shell.desktop-hint', '所有窗口已关闭 · 从底部 Dock 或左下角导航球打开页面')}
      </p>
      {items.length > 0 ? (
        <nav
          aria-label={t('Quick navigation')}
          className='grid max-w-xl grid-cols-4 gap-2 sm:grid-cols-5'
        >
          {items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.url}
                type='button'
                onClick={() => osNavigate(item.url)}
                title={item.title}
                className='hover:bg-popover/40 focus-visible:bg-popover/40 flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 outline-none transition-colors'
              >
                {Icon ? (
                  <span className='bg-popover/30 border-border/40 flex size-10 items-center justify-center rounded-lg border shadow-sm backdrop-blur-sm'>
                    <Icon className='text-foreground/80 size-5' aria-hidden='true' />
                  </span>
                ) : null}
                <span className='text-foreground/80 max-w-20 truncate text-xs'>
                  {item.title}
                </span>
              </button>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
