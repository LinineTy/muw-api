// @muw-owned
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { useIsAdmin } from '@/hooks/use-admin'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getUserNotifications, markAllNotificationsRead } from '../api'
import type { UserNotificationItem, UserNotificationPage } from '../types'

export const USER_NOTIFICATIONS_QUERY_KEY = ['user-notifications']

/** 未读轮询间隔：上游巡检 30 分钟一轮，1 分钟拉一次已足够及时，也不压服务器。 */
const UNREAD_POLL_MS = 60 * 1000

/**
 * 站内消息查询：边栏角标与消息弹窗**共用一份缓存**。
 * 只有管理员会收到上游巡检通知（后端就是这么筛人的），所以普通用户不轮询。
 */
export function useUserNotifications() {
  const isAdmin = useIsAdmin()
  return useQuery({
    queryKey: USER_NOTIFICATIONS_QUERY_KEY,
    queryFn: () => getUserNotifications({ page: 1, page_size: 20 }),
    enabled: isAdmin,
    refetchInterval: UNREAD_POLL_MS,
    staleTime: 30 * 1000,
  })
}

function NotificationRow({
  item,
  unread,
}: {
  item: UserNotificationItem
  unread: boolean
}) {
  return (
    <div
      data-unread={unread ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-1 rounded-lg border p-3',
        unread && 'border-primary/30 bg-primary/5'
      )}
    >
      <div className='flex items-center gap-2'>
        {unread && (
          <span
            className='bg-primary size-1.5 shrink-0 rounded-full'
            aria-hidden='true'
          />
        )}
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>
          {item.title}
        </span>
        <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
          {formatTimestampToDate(item.created_at, 'seconds')}
        </span>
      </div>
      {/* 后端正文是纯文本台账（带换行），按 pre-wrap 原样展示，不解析 HTML */}
      <p className='text-muted-foreground text-xs whitespace-pre-wrap'>
        {item.content}
      </p>
    </div>
  )
}

/**
 * 站内消息弹窗。入口是左侧细条的铃铛球（原「公告卡开关」位置 —— 公告开关已经
 * 并入「组件 / 鲸鱼」弹窗，两处能关同一个东西只会让人困惑过）。
 *
 * 打开即把未读标为已读（角标立刻清零），但**列表高亮按打开那一刻的快照**渲染：
 * 若标记完再重新拉列表，用户就分不清哪几条是刚到的。
 */
export function NotificationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isLoading } = useUserNotifications()
  const [unreadIds, setUnreadIds] = useState<number[]>([])
  const markedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      // 关掉后允许下次打开再走一遍标记流程
      markedRef.current = false
      return
    }
    if (markedRef.current || !data) return
    const ids = data.items
      .filter((item) => item.read_at === 0)
      .map((item) => item.id)
    if (ids.length === 0) return
    markedRef.current = true
    setUnreadIds(ids)
    void markAllNotificationsRead()
      .then(() => {
        // 只把未读数清零，不重拉列表 —— 否则高亮会立刻消失
        queryClient.setQueryData<UserNotificationPage>(
          USER_NOTIFICATIONS_QUERY_KEY,
          (old) => (old ? { ...old, unread: 0 } : old)
        )
      })
      .catch(() => {
        // 标记失败不影响阅读，角标保持未读，下次打开再试
      })
  }, [open, data, queryClient])

  const items = data?.items ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Notifications')}
      contentClassName='sm:max-w-xl'
      contentHeight='min(60vh, 32rem)'
    >
      {isLoading && items.length === 0 ? (
        <p className='text-muted-foreground p-3 text-sm'>{t('Loading...')}</p>
      ) : items.length === 0 ? (
        <div className='text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm'>
          <Inbox className='size-6' aria-hidden='true' />
          {t('No notifications yet')}
        </div>
      ) : (
        <div className='flex flex-col gap-2' data-testid='notifications-list'>
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              unread={unreadIds.includes(item.id)}
            />
          ))}
        </div>
      )}
    </Dialog>
  )
}
