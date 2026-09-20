// @muw-owned
import { APP_LOADING_TIMING, appLoadingBrandName } from '@/lib/app-loading'
import { cn } from '@/lib/utils'

type AppLoadingProps = {
  className?: string
  name?: string
}

/**
 * 加载占位:站点名逐字上浮 + 轻微呼吸,用于首屏/内容未就绪的空窗。
 * 视觉与 `index.html` 内联的那份一致(见 `@/lib/app-loading` 顶部说明)。
 */
export function AppLoading(props: AppLoadingProps) {
  const name = props.name?.trim() || appLoadingBrandName()

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
          className='app-loading-letter'
          // 与 index.html 的内联占位同一条时序:整体延迟 150ms,每字 +40ms
          style={{
            animationDelay: `${
              APP_LOADING_TIMING.showDelayMs +
              index * APP_LOADING_TIMING.staggerMs
            }ms`,
          }}
        >
          {char === ' ' ? '\u00a0' : char}
        </span>
      ))}
    </span>
  )
}
