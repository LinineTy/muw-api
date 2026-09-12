// @muw-owned
import { ChevronDown, ChevronUp, X } from 'lucide-react'
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
import { OsWidget } from './os-widget'

/**
 * OS 桌面 · 时间线公告**小组件**（3x2）
 *
 * 只取「时间线」（announcements）——通知（notice）已经有糊脸强制阅读弹窗，桌面不重复。
 *
 * 2026-09-12 maintainer定的形态：**全量元素进卡，一次只显示一条公告，卡底部给上下翻页按钮**。
 * 比原来的「堆叠露出多张」更彻底地根除接缝鬼影 —— 只有一张卡，卡与卡之间不存在接缝，
 * 也就不存在「鼠标移出页面后接缝处冒黑线、只有重绘才恢复」那类合成层陈旧绘制问题。
 * 默认显示最新一条；点卡体或底部箭头都能翻（循环）。无公告时不渲染，桌面保持干净。
 *
 * 2026-09-12 晚：迁入小组件系统（os-widget.tsx）当第一个样例。
 * 尺寸改由网格 span 决定（3x2 = 21.5 × 12.75rem），组件内不再写 `w-[21rem]` / 固定高度 ——
 * 那次的「宽度跟着公告长短变、右边漏空档」就是"组件自己定尺寸"造成的，系统里不再有这种口子。
 */
export function OsDesktopNotices() {
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

  const showPrev = useCallback(() => {
    setActive((current) => (total > 0 ? (current - 1 + total) % total : 0))
  }, [total])

  // 卡内是富文本：点链接照常打开、点按钮走按钮自己的逻辑，都不触发翻页
  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('a, button')) return
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

  const current: AnnouncementItem =
    announcements[Math.min(active, total - 1)]
  const publishDate = current.publishDate ? new Date(current.publishDate) : null
  const relativeTime = publishDate ? getRelativeTime(publishDate, t) : ''
  const absoluteTime = publishDate ? formatDateTimeObject(publishDate) : ''

  return (
    <OsWidget
      size='3x2'
      aria-hidden={hidden}
      title={t('System Announcements')}
      subtitle={t('Latest platform updates and notices')}
      actions={
        <button
          type='button'
          onClick={() => setCollapsed(true)}
          title={t('Close')}
          aria-label={t('Close')}
          className='text-muted-foreground hover:text-foreground -mt-0.5 -mr-1 shrink-0 rounded-md p-1 transition-colors'
        >
          <X className='size-3.5' aria-hidden='true' />
        </button>
      }
      footer={
        <>
          <span>
            {active + 1} / {total}
          </span>
          <div className='flex items-center gap-0.5'>
            <button
              type='button'
              onClick={showPrev}
              title={t('Previous announcement')}
              aria-label={t('Previous announcement')}
              className='hover:text-foreground hover:bg-muted rounded-md p-1 transition-colors'
            >
              <ChevronUp className='size-4' aria-hidden='true' />
            </button>
            <button
              type='button'
              onClick={showNext}
              title={t('Next announcement')}
              aria-label={t('Next announcement')}
              className='hover:text-foreground hover:bg-muted rounded-md p-1 transition-colors'
            >
              <ChevronDown className='size-4' aria-hidden='true' />
            </button>
          </div>
        </>
      }
      className={cn(
        // 尺寸不在这里定：由网格 span（3x2）算出来，宽度不可能再跟着公告长短变
        'transition-[opacity,translate] duration-300 ease-out',
        hidden
          ? 'pointer-events-none translate-x-3 opacity-0'
          : 'translate-x-0 opacity-100'
      )}
    >
      {/* 正文：一次只显示一条，内容长了在卡内滚动；点卡体翻到下一条 */}
      <div
        role='button'
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        className='focus-visible:ring-ring/40 flex min-h-0 flex-1 cursor-pointer items-start gap-3 overflow-y-auto pr-1 outline-none focus-visible:ring-2'
      >
        <AnnouncementDot type={current.type} />
        <div className='flex min-w-0 flex-1 flex-col gap-2'>
          <div className='text-sm'>
            <RichContent breaks content={current.content || ''} />
          </div>

          {current.extra ? (
            <div className='text-muted-foreground text-xs'>
              <RichContent breaks content={current.extra} />
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
    </OsWidget>
  )
}
