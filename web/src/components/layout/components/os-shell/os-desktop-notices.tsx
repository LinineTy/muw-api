// @muw-owned
import { ChevronDown, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AnnouncementDot,
  getRelativeTime,
  type AnnouncementItem,
} from '@/components/announcements-list'
import { RichContent } from '@/components/rich-content'
import { useNotifications } from '@/hooks/use-notifications'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

import { useOsNoticeStore } from './os-notice-store'

/**
 * 堆叠里最多露出几张（含最前面那张完整卡）。
 * 最前面一张是完整卡，后面每张只在下方露出 `STACK_STEP_REM` 的一小节。
 */
const VISIBLE_STACK = 3
/** 完整卡高度（rem）——「大框」 */
const CARD_HEIGHT_REM = 12
/** 后面每张露出的高度（rem）——「下面一小节」 */
const STACK_STEP_REM = 2.6
/**
 * 后面每张**上移**这么多（rem），把自己的上边框塞到前一张卡底下。
 * 不塞的话两张卡的 1px 边框会在接缝处叠成一条深色线（浅色主题下都能量出来，
 * 琉璃主题压在深色壁纸上就像「黑线」）——2026-09-12 maintainer反馈。
 */
const STACK_TUCK_REM = 0.2

/**
 * OS 桌面右侧 · 时间线公告堆叠卡
 *
 * 只取「时间线」（announcements）——通知（notice）已经有糊脸强制阅读弹窗，桌面不重复。
 * 一卡一条公告：最前面一张完整展示，后面每张只在下方露出一小节（大框 + 小节）；
 * 点任意一张（或底部箭头）滚到下一张，循环。无公告时不渲染，桌面保持干净。
 */
export function OsDesktopNotices({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { announcements, loading, unreadAnnouncementsCount } = useNotifications()
  const total = announcements.length
  const [active, setActive] = useState(0)
  const collapsed = useOsNoticeStore((state) => state.collapsed)
  const setCollapsed = useOsNoticeStore((state) => state.setCollapsed)
  // 首次挂载后再置真：首帧透明，靠 CSS 过渡淡入（否则是硬切）
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // 有新公告（未读数增加）自动恢复显示；手动收起后不会被反复弹开
  const previousUnread = useRef(unreadAnnouncementsCount)
  useEffect(() => {
    if (unreadAnnouncementsCount > previousUnread.current) {
      setCollapsed(false)
    }
    previousUnread.current = unreadAnnouncementsCount
  }, [unreadAnnouncementsCount, setCollapsed])

  // 公告数量变化（后台增删）后收敛索引，避免越界后空白
  useEffect(() => {
    if (total > 0 && active >= total) {
      setActive(0)
    }
  }, [active, total])

  const showNext = useCallback(() => {
    setActive((current) => (total > 0 ? (current + 1) % total : 0))
  }, [total])

  // 卡内有富文本链接：点链接照常打开，不触发翻页
  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('a')) return
      showNext()
    },
    [showNext]
  )

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        showNext()
      }
    },
    [showNext]
  )

  // 无数据时不渲染；收起则保留挂载走过渡（卸载就没有动画了）
  if (loading || total === 0) {
    return null
  }

  const hidden = collapsed || !entered

  const visibleCount = Math.min(VISIBLE_STACK, total)

  return (
    <div
      aria-hidden={hidden}
      className={cn(
        // ⚠️ 不要给这个 wrapper 加 will-change / filter / opacity 之外的合成提示：
        // 它们会把 wrapper 变成 backdrop root，里面每张卡的 backdrop-blur 只能采样
        // 到这个 root 内部，Chrome 在卡与卡的接缝处会画出一条硬边/黑线
        // （2026-09-12 maintainer反馈：鼠标移出页面后接缝处冒黑线，hover 卡片才消失
        //  = 典型的重绘/合成层陈旧问题；去掉这个 hint 让卡片直接采样页面背景）
        'flex w-[21rem] flex-col gap-3 transition-[opacity,translate] duration-300 ease-out',
        hidden
          ? 'pointer-events-none translate-x-3 opacity-0'
          : 'translate-x-0 opacity-100',
        className
      )}
    >
      <div className='flex items-start justify-between gap-2 px-1'>
        <div className='min-w-0'>
          <p className='text-sm font-medium'>{t('System Announcements')}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {t('Latest platform updates and notices')}
          </p>
        </div>
        <button
          type='button'
          onClick={() => setCollapsed(true)}
          title={t('Close')}
          aria-label={t('Close')}
          className='text-muted-foreground hover:text-foreground -mt-0.5 shrink-0 rounded-md p-1 transition-colors'
        >
          <X className='size-3.5' aria-hidden='true' />
        </button>
      </div>

      <div
        className='relative'
        style={{
          height: `calc(${CARD_HEIGHT_REM}rem + ${
            (visibleCount - 1) * STACK_STEP_REM
          }rem)`,
        }}
      >
        {announcements.map((item: AnnouncementItem, idx) => {
          const pos = (idx - active + total) % total
          if (pos >= visibleCount) return null

          const isFront = pos === 0
          const publishDate = item.publishDate
            ? new Date(item.publishDate)
            : null
          const relativeTime = publishDate
            ? getRelativeTime(publishDate, t)
            : ''
          const absoluteTime = publishDate
            ? formatDateTimeObject(publishDate)
            : ''
          const key =
            item.id !== undefined && item.id !== null
              ? `id:${item.id}`
              : `idx:${idx}`

          return (
            <div
              key={key}
              role='button'
              tabIndex={0}
              onClick={handleCardClick}
              onKeyDown={handleCardKeyDown}
              style={{
                // 只有最前面一张是完整卡，后面每张整体挪到下面、高度只留一小节
                top: `${
                  isFront
                    ? 0
                    : CARD_HEIGHT_REM +
                      (pos - 1) * STACK_STEP_REM -
                      STACK_TUCK_REM
                }rem`,
                height: `${
                  isFront ? CARD_HEIGHT_REM : STACK_STEP_REM + STACK_TUCK_REM
                }rem`,
                zIndex: visibleCount - pos,
              }}
              className={cn(
                // 非琉璃主题下也要看得出「一块一卡」：底色更实、边框更清楚、投影更明显
                'bg-card/90 border-border/70 hover:border-border focus-visible:ring-ring/40 shadow-md hover:shadow-lg absolute inset-x-0 flex cursor-pointer flex-col overflow-hidden rounded-2xl border px-4 py-3 text-left backdrop-blur-md transition-[top,height,border-color,box-shadow] duration-300 ease-out outline-none focus-visible:ring-2'
              )}
            >
              <div
                className={cn(
                  'flex min-h-0 flex-1 items-start gap-3 pr-1',
                  isFront && 'overflow-y-auto'
                )}
              >
                <AnnouncementDot type={item.type} />
                <div className='flex min-w-0 flex-1 flex-col gap-2'>
                  <div className='text-sm'>
                    <RichContent breaks content={item.content || ''} />
                  </div>

                  {item.extra ? (
                    <div className='text-muted-foreground text-xs'>
                      <RichContent breaks content={item.extra} />
                    </div>
                  ) : null}

                  {absoluteTime ? (
                    <div className='text-muted-foreground text-xs'>
                      {relativeTime ? `${relativeTime} • ` : null}
                      {absoluteTime}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className='text-muted-foreground flex items-center justify-between px-1 text-xs'>
        <span>
          {active + 1} / {total}
        </span>
        <button
          type='button'
          onClick={showNext}
          title={t('Next')}
          aria-label={t('Next')}
          className='hover:text-foreground rounded-md p-0.5 transition-colors'
        >
          <ChevronDown className='size-4' aria-hidden='true' />
        </button>
      </div>
    </div>
  )
}
