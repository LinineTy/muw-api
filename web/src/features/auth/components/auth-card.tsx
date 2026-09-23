// @muw-owned
import * as React from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { BADGE } from '../lib/auth-card-geometry'
import { AuthCardBadge, type AuthCardBadgeKind } from './auth-card-badge'

/**
 * 认证页卡壳：卡外标题区 + 主卡 + 底部次要文字带 + 右下状态角标。
 *
 * 几何（与设计稿一致，改数值请连同注释一起改）：
 * - 角标 = 5×3 格（列 26px / 行 16px）⇒ 130×48，压在右下；外露主卡右侧 8px、下方 10px。
 * - 底部文字带高 44px 并垂直居中 ⇒ 文字中心落在角标「1/2 行分界线」上
 *   （角标底 10px + 角标高 48 的 1/3 关系：48×2/3 − 10 = 22 = 44/2）。
 * - 文字带右侧让出 130 − 8 + 14 = 136px，避免压到角标。
 */
type AuthCardProps = {
  /** 卡外标题区第一行（如「登录」） */
  title: React.ReactNode
  /** 卡外标题区第二行（如「还没有账号？注册。」），可带链接 */
  subtitle?: React.ReactNode
  /** 右下角标内容；不传则不渲染角标 */
  badge?: AuthCardBadgeKind
  /** 角标文案（已翻译） */
  badgeLabel?: string
  /** 主卡底部次要文字区（与角标 1/2 行线对齐） */
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function AuthCard({
  title,
  subtitle,
  badge,
  badgeLabel,
  footer,
  className,
  children,
}: AuthCardProps) {
  return (
    <div className={cn('w-full', className)}>
      <div className='mb-4'>
        <h2 className='text-2xl font-semibold tracking-tight'>{title}</h2>
        {subtitle ? (
          <p className='text-muted-foreground mt-1.5 text-sm'>{subtitle}</p>
        ) : null}
      </div>

      <div className='relative'>
        <Card data-card-hover='false' className='gap-0 py-0'>
          <CardContent className='grid gap-3.5 px-5 pt-6'>
            {children}
          </CardContent>
          {footer ? (
            <div
              className='flex min-h-11 items-center gap-3.5 px-5'
              style={{ paddingRight: BADGE.width - BADGE.outRight + BADGE.gap }}
            >
              {footer}
            </div>
          ) : (
            <div className='h-4' />
          )}
        </Card>

        {badge ? <AuthCardBadge kind={badge} label={badgeLabel} /> : null}
      </div>
    </div>
  )
}
