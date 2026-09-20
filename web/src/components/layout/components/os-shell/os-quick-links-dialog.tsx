// @muw-owned
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, ChevronRight, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'

/**
 * OS 桌面壳 · 「快速导航」弹窗。
 *
 * 收纳管理端 HeaderNavModules 配置的顶栏页面链接。原来是一颗球 + 下拉菜单
 * （菜单项一行一个小图标，挤且点不准）—— 2026-09-21 maintainer要"弹窗、好看些"，
 * 改成弹窗里一行一个链接卡片：图标 + 标题 + 方向指示（站内 →、外链 ↗）。
 */
export function OsQuickLinksDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const links = useTopNavLinks()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Quick links')}
      contentClassName='sm:max-w-lg'
    >
      <div className='flex flex-col gap-2' data-testid='quick-links-list'>
        {links.map((link) => {
          const rowClassName =
            'flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent'
          const content = (
            <>
              <Globe
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
              <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                {link.title}
              </span>
              {link.external ? (
                <ArrowUpRight
                  className='text-muted-foreground size-4 shrink-0'
                  aria-hidden='true'
                />
              ) : (
                <ChevronRight
                  className='text-muted-foreground size-4 shrink-0'
                  aria-hidden='true'
                />
              )}
            </>
          )

          return link.external ? (
            <a
              key={link.href}
              href={link.href}
              target='_blank'
              rel='noreferrer'
              title={t('Open in new tab')}
              className={rowClassName}
              onClick={() => onOpenChange(false)}
            >
              {content}
            </a>
          ) : (
            <Link
              key={link.href}
              to={link.href}
              className={rowClassName}
              onClick={() => onOpenChange(false)}
            >
              {content}
            </Link>
          )
        })}
      </div>
    </Dialog>
  )
}
