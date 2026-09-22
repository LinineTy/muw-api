// @muw-owned
import {
  APP_LOADING_TIMING,
  appLoadingBrandName,
  splashBootRoundPlayed,
} from '@/lib/app-loading'
import { cn } from '@/lib/utils'

type AppLoadingProps = {
  className?: string
  name?: string
  /** 首屏那一轮已经播过时,这里只静态显示(不再逐字上浮),让两屏之间是接续而不是重来 */
  settled?: boolean
}

/**
 * 加载占位:站点名逐字上浮 + 轻微呼吸,用于首屏/内容未就绪的空窗。
 * 视觉与 `index.html` 内联的那份一致(见 `@/lib/app-loading` 顶部说明)。
 */
export function AppLoading(props: AppLoadingProps) {
  const name = props.name?.trim() || appLoadingBrandName()
  const settled = props.settled ?? splashBootRoundPlayed()

  return (
    <span
      className={cn('app-loading-brand', props.className)}
      aria-hidden='true'
    >
      {Array.from(name).map((char, index) => (
        <span
          // 站点名是定长字符串(不会重排),逐字位置就是它的身份
          // oxlint-disable-next-line react/no-array-index-key
          key={`${char}-${index}`}
          className={cn(
            'app-loading-letter',
            settled && 'app-loading-letter-settled'
          )}
          // 与 index.html 的内联占位同一条时序:整体延迟 150ms,每字 +40ms
          // 接续首屏那一轮时不设延迟(样式里已直接落定)
          style={
            settled
              ? undefined
              : {
                  animationDelay: `${
                    APP_LOADING_TIMING.showDelayMs +
                    index * APP_LOADING_TIMING.staggerMs
                  }ms`,
                }
          }
        >
          {char === ' ' ? '\u00a0' : char}
        </span>
      ))}
    </span>
  )
}
