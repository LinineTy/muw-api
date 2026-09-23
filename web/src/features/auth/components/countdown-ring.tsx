// @muw-owned
import { cn } from '@/lib/utils'

/** 环周长：r=18 ⇒ 2πr ≈ 113.1（与设计稿一致，改 r 请同步改这里） */
const CIRCUMFERENCE = 113.1

type CountdownRingProps = {
  /** 剩余秒数（显示在环内） */
  secondsLeft: number
  /** 总秒数（决定环的进度比例） */
  totalSeconds: number
  className?: string
}

/**
 * 自动跳转倒计时圆环：30px、环内数字，进度按剩余秒数走。
 * 卡外副标题行用它替代原来的横向进度条（设计稿口径）。
 */
export function CountdownRing({
  secondsLeft,
  totalSeconds,
  className,
}: CountdownRingProps) {
  const elapsed = totalSeconds > 0 ? 1 - secondsLeft / totalSeconds : 0
  const offset = CIRCUMFERENCE * Math.min(Math.max(elapsed, 0), 1)

  return (
    <span
      role='timer'
      aria-live='off'
      className={cn(
        'text-primary relative inline-grid size-[30px] shrink-0 place-items-center',
        className
      )}
    >
      <svg
        viewBox='0 0 44 44'
        className='size-full -rotate-90'
        aria-hidden='true'
      >
        <circle
          cx='22'
          cy='22'
          r='18'
          fill='none'
          strokeWidth='3.4'
          className='stroke-border'
        />
        <circle
          cx='22'
          cy='22'
          r='18'
          fill='none'
          strokeWidth='3.4'
          strokeLinecap='round'
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className='stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear'
        />
      </svg>
      <span className='text-foreground absolute text-[11.5px] font-semibold tabular-nums'>
        {secondsLeft}
      </span>
    </span>
  )
}
