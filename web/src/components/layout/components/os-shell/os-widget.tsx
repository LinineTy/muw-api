// @muw-owned
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * OS 桌面 · 小组件系统（v1）
 *
 * 定位：桌面右侧**分区**里的数据卡（左区是图标网格，两区共用同一套度量）。
 * 度量与图标网格完全一致 —— 列 7rem、行 6.25rem、列缝 0.25rem、行缝 0.5rem，
 * 所以小组件的边缘天然和图标对齐（见 os-widget-grid.tsx 的 WIDGET_GRID_STYLE）。
 *
 * ⚠️ 核心纪律：**尺寸由网格 span 决定，绝不由内容决定**。
 * 组件内容只负责"填满给它的格子"，不许撑开或缩小自己 —— 2026-09-12 踩过：
 * 公告卡当时没有定尺寸，宽度跟着内容变（短公告 233px / 应有 336px），
 * 右边多出一截空档。在系统里 `gridColumn/gridRow` 的 span 就是尺寸的唯一来源，
 * 内容再长也只是在自己格子里滚动，结构上不可能复现那类问题。
 *
 * 尺寸档（只开这 5 档，避免"每个组件长一个样"）：
 *   1x1 = 7 × 6.25rem      单值（一个数字/一个图标级信息）
 *   2x1 = 14.25 × 6.25rem  一条数据 + 标签
 *   2x2 = 14.25 × 12.75rem 带迷你图
 *   3x2 = 21.5 × 12.75rem  标准卡（公告卡就是这档）
 *   3x3 = 21.5 × 19.25rem  列表 / 多行
 *
 * 圆角**随行数走**，并且**一律用主题 token**（不写死 px，跟"圆角"设置一起缩放）：
 *   单行卡（1x1 / 2x1）→ `rounded-lg`（= --radius）
 *   两行以上（2x2 / 3x2 / 3x3）→ `rounded-xl`（= --radius × 1.4，与全站 Card / Dialog 同档）
 * 单行卡只有 6.25rem(100px) 高，用大卡的档位会让圆角吃掉三四成高度、内容贴到弧线上
 * 像"糊边"（2026-09-12 实测性能显示那两张 1x1 最明显），所以小卡降一档。
 */
export type OsWidgetSize = '1x1' | '2x1' | '2x2' | '3x2' | '3x3'

const SIZE_SPAN: Record<
  OsWidgetSize,
  { col: number; row: number; radius: string }
> = {
  '1x1': { col: 1, row: 1, radius: 'rounded-lg' },
  '2x1': { col: 2, row: 1, radius: 'rounded-lg' },
  // 大卡用 rounded-xl（= --radius × 1.4），与全站 Card / Dialog 同一档；
  // 原来写 rounded-2xl（× 1.8）→ 圆角设置选 1.0 时实际是 1.8rem=28.8px，明显比设置值大一圈
  //（2026-09-12：琉璃的圆角比预设 1.0 还大）
  '2x2': { col: 2, row: 2, radius: 'rounded-xl' },
  '3x2': { col: 3, row: 2, radius: 'rounded-xl' },
  '3x3': { col: 3, row: 3, radius: 'rounded-xl' },
}

/**
 * 整卡可点时的内容按钮样式：铺满内容区、上下分栏（标签在上、数值在下）。
 * 壳本身保持非交互（`<section>`），要整卡可点就在 children 里放一个用这个类名的 button。
 */
export const WIDGET_CLICKABLE_CLASS =
  'focus-visible:ring-ring/40 flex h-full w-full cursor-pointer flex-col justify-between gap-1 text-left outline-none focus-visible:ring-2'

export interface OsWidgetProps {
  size: OsWidgetSize
  /** 标题行；1x1 这种小格子建议不传，直接用内容区的数字 */
  title?: ReactNode
  subtitle?: ReactNode
  /** 标题行右侧的操作（关闭、刷新、跳转之类） */
  actions?: ReactNode
  /** 底部行（计数、翻页、次要信息） */
  footer?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  /** 收起/淡出态用；交给网格保留占位（组件卸载会让网格塌一格） */
  'aria-hidden'?: boolean
}

export function OsWidget({
  size,
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
  bodyClassName,
  'aria-hidden': ariaHidden,
}: OsWidgetProps) {
  const span = SIZE_SPAN[size]
  // 1x1 只有 7×6.25rem，标题行用小一号字（正文内边距**不**再收紧，见下）
  const compact = size === '1x1'

  return (
    <section
      aria-hidden={ariaHidden}
      style={{
        gridColumn: `span ${span.col}`,
        gridRow: `span ${span.row}`,
      }}
      className={cn(
        // 与公告卡同一套琉璃底：卡自身不透明度过低，靠 backdrop-blur 出材质。
        // ⚠️ 不留阴影（2026-09-12：底部阴影很出戏）：Tailwind 的 shadow-md
        // 是贴边的小硬阴影，在浅色壁纸上会给每张卡糊一条灰边；组件是"贴在桌面上"的元素，
        // 不像 Dock/窗口那样悬浮（那两处用的是 0_12px_40px 这类大范围柔影）。无阴影与磁贴一致。
        // ⚠️ 内边距**不小于圆角半径**（圆角 1rem ⇒ 内边距 1rem/0.75rem）：
        // 1x1 原来单独收紧成 px-3 py-2，内容贴到圆角上像"糊边"（2026-09-12 实测性能显示那两张最明显）。
        // 所有尺寸统一 px-4 py-3，也顺便让各卡的标签左缘对齐在同一条竖线上。
        'bg-card/90 border-border/70 flex h-full w-full flex-col overflow-hidden border px-4 py-3 backdrop-blur-md',
        span.radius,
        className
      )}
    >
      {title ? (
        <header className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <p
              className={cn(
                'truncate font-medium',
                compact ? 'text-xs' : 'text-sm'
              )}
            >
              {title}
            </p>
            {subtitle ? (
              <p className='text-muted-foreground truncate text-xs'>
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className='flex shrink-0 items-center gap-0.5'>{actions}</div>
          ) : null}
        </header>
      ) : null}

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          title && (compact ? 'mt-1.5' : 'mt-3'),
          bodyClassName
        )}
      >
        {children}
      </div>

      {footer ? (
        <div className='text-muted-foreground mt-3 flex items-center justify-between text-xs'>
          {footer}
        </div>
      ) : null}
    </section>
  )
}
