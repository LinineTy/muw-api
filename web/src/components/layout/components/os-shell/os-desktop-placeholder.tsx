// @muw-owned
import { useTranslation } from 'react-i18next'

import { useOsShellNavigate } from './os-open'
import { useOsNavGroups } from './use-os-nav'

/**
 * OS 桌面壳 · 空桌面态:
 * 窗口被关闭(红点)后显示提示 + 按导航分组展示快速导航。
 * 形态与 Dock 的开始磁贴一致(分组标题 + 图标格子),区别是桌面版用**圆角方形**
 * 磁贴,更接近"桌面图标"的手感;开始磁贴面板保持不变(见 nav-tiles.tsx)。
 * 品牌不在这里——已迁到左侧细竖条顶端(见 os-side-strip.tsx)。
 */
export function OsDesktopPlaceholder() {
  const { t } = useTranslation()
  const groups = useOsNavGroups()
  const osNavigate = useOsShellNavigate()

  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-8 overflow-y-auto p-6'>
      <p className='text-muted-foreground/70 max-w-xs text-center text-sm'>
        {t('os-shell.desktop-hint')}
      </p>
      {groups.length > 0 ? (
        <div className='flex w-full max-w-5xl flex-wrap items-start justify-center gap-x-12 gap-y-8'>
          {groups.map((group) => (
            <div key={group.id} className='flex min-w-40 flex-col gap-3'>
              <div className='text-muted-foreground/70 border-border/40 mb-1 border-b pb-1.5 text-center text-[0.68rem] font-medium tracking-wide'>
                {group.title}
              </div>
              <div className='flex flex-wrap justify-center gap-1.5'>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.url}
                      type='button'
                      onClick={() => osNavigate(item.url)}
                      title={item.title}
                      className='group hover:bg-popover/40 focus-visible:ring-ring/40 flex w-[5.25rem] flex-col items-center gap-1.5 rounded-2xl px-1 py-2 transition-colors outline-none focus-visible:ring-2'
                    >
                      {/* 方圆形磁贴:圆角约 20%,玻璃底,与 Dock 的圆形球体区分 */}
                      <span className='bg-popover/55 border-border/40 group-hover:border-border/70 flex size-12 items-center justify-center rounded-[0.95rem] border backdrop-blur-[6px] transition-transform duration-200 group-hover:scale-[1.04]'>
                        {Icon ? (
                          <Icon className='size-5' aria-hidden='true' />
                        ) : null}
                      </span>
                      <span className='line-clamp-2 w-full text-center text-xs leading-tight'>
                        {item.title}
                      </span>
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
