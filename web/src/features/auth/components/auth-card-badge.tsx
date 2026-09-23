import { cn } from '@/lib/utils'

// @muw-owned
import { BADGE } from '../lib/auth-card-geometry'

/**
 * 右下状态角标（叠卡）的几何：5×3 格（列 26px / 行 16px）⇒ 130×48，
 * 外露主卡右侧 8px、下方 10px。改数值请连同 AuthCard 的文字带让位一起改。
 */
export type AuthCardBadgeKind = 'secure' | 'success' | 'activate' | 'fail'

const BADGE_ICON: Record<AuthCardBadgeKind, React.ReactNode> = {
  secure: (
    <path d='M12 3l7 3v5.5c0 4.3-2.9 7.8-7 9.2-4.1-1.4-7-4.9-7-9.2V6l7-3Zm-2.8 9.2 2 2 3.6-3.8' />
  ),
  success: <path d='M20 6.5 9.5 17 4 11.5' />,
  activate: <path d='M12 4.5l8 14.5H4l8-14.5ZM12 10v4M12 17.2h.01' />,
  fail: (
    <>
      <circle cx='12' cy='12' r='9' />
      <path d='M9 9l6 6M15 9l-6 6' />
    </>
  ),
}

const BADGE_TONE: Record<AuthCardBadgeKind, string> = {
  secure: 'bg-primary/15 text-primary',
  success: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  activate: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  fail: 'bg-destructive/15 text-destructive',
}

type AuthCardBadgeProps = {
  kind: AuthCardBadgeKind
  /** 已翻译的角标文案 */
  label?: string
}

/** 卡片右下角的状态角标（叠卡）。绝对定位，父级需 relative。 */
export function AuthCardBadge({ kind, label }: AuthCardBadgeProps) {
  return (
    <div
      className='bg-card border-border absolute z-10 flex items-center gap-[9px] rounded-2xl border px-[14px] shadow-lg'
      style={{
        width: BADGE.width,
        height: BADGE.height,
        right: -BADGE.outRight,
        bottom: -BADGE.outBottom,
      }}
    >
      <span
        className={cn(
          'grid size-[30px] shrink-0 place-items-center rounded-[10px]',
          BADGE_TONE[kind]
        )}
      >
        <svg
          viewBox='0 0 24 24'
          className='size-[15px]'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden='true'
        >
          {BADGE_ICON[kind]}
        </svg>
      </span>
      {label ? (
        <span className='text-[13px] leading-tight font-semibold'>{label}</span>
      ) : null}
    </div>
  )
}
