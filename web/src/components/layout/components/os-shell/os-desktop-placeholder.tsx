// @muw-owned
import { useTranslation } from 'react-i18next'

import { useDirection } from '@/context/direction-provider'
import { cn } from '@/lib/utils'

import { useOsShellNavigate } from './os-open'
import { useOsNavGroups } from './use-os-nav'

/**
 * OS 桌面壳 · 空桌面态:
 * 窗口被关闭(红点)后显示提示 + 按导航分组展示快速导航。
 * 形态与 Dock 的开始磁贴一致(分组标题 + 图标格子),区别是桌面版用**圆角方形**
 * 磁贴,更接近"桌面图标"的手感;开始磁贴面板保持不变(见 nav-tiles.tsx)。
 * 品牌不在这里——已迁到左侧细竖条顶端(见 os-side-strip.tsx)。
 *
 * 排布:整块**从左上角起**、列宽固定(7rem)、auto-fill 等距铺开——
 * 早先是"每组各自居中"的 flex-wrap,边缘参差且疏密不均。
 * 左/右留出细条的宽度,否则内容会被竖条压住。
 */
export function OsDesktopPlaceholder() {
  const { t } = useTranslation()
  const groups = useOsNavGroups()
  const osNavigate = useOsShellNavigate()
  const { dir } = useDirection()
  const rtl = dir === 'rtl'

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-start gap-7 overflow-y-auto py-8',
        // 细条宽 48px 贴边 4px:内容至少让出 56px,再留一点呼吸
        rtl ? 'pr-16 pl-8' : 'pl-16 pr-8'
      )}
    >
      <p className='text-muted-foreground/60 text-xs'>
        {t('os-shell.desktop-hint')}
      </p>
      {groups.map((group) => (
        <section key={group.id} className='flex w-full flex-col gap-3'>
          <div className='text-muted-foreground/60 text-[0.7rem] font-medium tracking-wide'>
            {group.title}
          </div>
          <div
            className='grid w-full gap-x-1 gap-y-3'
            style={{ gridTemplateColumns: 'repeat(auto-fill, 7rem)' }}
          >
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.url}
                  type='button'
                  onClick={() => osNavigate(item.url)}
                  title={item.title}
                  className='group hover:bg-popover/40 focus-visible:ring-ring/40 flex w-full flex-col items-center gap-2 rounded-xl px-1 py-2 transition-colors outline-none focus-visible:ring-2'
                >
                  {/* 方圆形磁贴:圆角约 20%,玻璃底,与 Dock 的圆形球体区分 */}
                  <span className='bg-popover/55 border-border/40 group-hover:border-border/70 flex size-14 items-center justify-center rounded-[1.15rem] border backdrop-blur-[6px] transition-transform duration-200 group-hover:scale-[1.04]'>
                    {Icon ? (
                      <Icon className='size-6' aria-hidden='true' />
                    ) : null}
                  </span>
                  <span className='line-clamp-2 w-full text-center text-xs leading-tight'>
                    {item.title}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
