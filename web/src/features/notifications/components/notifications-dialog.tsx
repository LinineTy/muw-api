// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCheck, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsAdmin } from '@/hooks/use-admin'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from '../api'
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

/**
 * 标为已读的本地乐观更新：命中的未读条目补上 read_at，角标按**真正被翻成已读的条数**递减。
 *
 * 服务端的 `unread` 是"全部未读"（不受分页影响），所以只能减本页真正变化的条数 ——
 * 用 ids.length 直接减，重复点已读的行会把角标算多。
 */
function applyMarkedRead(
  old: UserNotificationPage | undefined,
  ids: number[]
): UserNotificationPage | undefined {
  if (!old || ids.length === 0) return old
  const idSet = new Set(ids)
  const now = Math.floor(Date.now() / 1000)
  let touched = 0
  const items = old.items.map((item) => {
    if (item.read_at !== 0 || !idSet.has(item.id)) return item
    touched += 1
    return { ...item, read_at: now }
  })
  if (touched === 0) return old
  return { ...old, unread: Math.max(0, old.unread - touched), items }
}

function NotificationRow({
  item,
  marking,
  onMarkRead,
}: {
  item: UserNotificationItem
  marking: boolean
  onMarkRead: (id: number) => void
}) {
  const { t } = useTranslation()
  const unread = item.read_at === 0

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
        {unread && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  disabled={marking}
                  onClick={() => onMarkRead(item.id)}
                  aria-label={t('Mark as read')}
                  data-testid={`notification-mark-read-${item.id}`}
                />
              }
            >
              <Check className='size-3.5' />
            </TooltipTrigger>
            <TooltipContent>{t('Mark as read')}</TooltipContent>
          </Tooltip>
        )}
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
 * 已读策略（2026-09-21定）：**打开不再把未读一次清空**——一点开角标就没了，
 * 分不清新到的是哪条、也看不到"读一条少一条"。现在每条未读行右侧有「标为已读」，
 * 点一下该条已读、角标 -1；要一次清完用列表上方的「全部已读」。
 * 角标与列表共用同一份缓存，两边永远同步。
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
  const items = data?.items ?? []
  const unread = data?.unread ?? 0

  // 标记失败（网络 / 服务端拒绝）就把缓存拉回服务端真实状态：角标宁可回到未读，
  // 也不能少算了却没人知道
  const resync = () =>
    queryClient.invalidateQueries({ queryKey: USER_NOTIFICATIONS_QUERY_KEY })

  const markRead = useMutation({
    mutationFn: (ids: number[]) => markNotificationsRead(ids),
    onMutate: (ids) => {
      queryClient.setQueryData<UserNotificationPage>(
        USER_NOTIFICATIONS_QUERY_KEY,
        (old) => applyMarkedRead(old, ids)
      )
    },
    onError: resync,
  })

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: () => {
      queryClient.setQueryData<UserNotificationPage>(
        USER_NOTIFICATIONS_QUERY_KEY,
        (old) => {
          if (!old) return old
          const marked =
            applyMarkedRead(
              old,
              old.items.map((item) => item.id)
            ) ?? old
          // 服务端清的是全部未读（不止本页），角标直接归零
          return { ...marked, unread: 0 }
        }
      )
    },
    onError: resync,
  })

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
          {unread > 0 && (
            <div className='flex justify-end'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='text-muted-foreground hover:text-foreground'
                disabled={markAll.isPending}
                onClick={() => markAll.mutate()}
                aria-label={t('Mark all as read')}
                data-testid='notifications-mark-all'
              >
                <CheckCheck className='size-3.5' />
                {t('Mark all as read')}
              </Button>
            </div>
          )}
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              marking={markRead.isPending}
              onMarkRead={(id) => markRead.mutate([id])}
            />
          ))}
        </div>
      )}
    </Dialog>
  )
}
