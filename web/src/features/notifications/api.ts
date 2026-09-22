// @muw-owned
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { UserNotificationPage } from './types'

/**
 * 站内消息（网页「消息」窗口）。
 *
 * 走 requireServerSuccess：后端业务失败也是 HTTP 200 + success:false（此时没有 data），
 * 直接取 data.data 会变成 undefined 再炸在调用处（2026-09-20 账户余额那个事故同款）。
 */
export async function getUserNotifications(params: {
  page?: number
  page_size?: number
  unread_only?: boolean
}): Promise<UserNotificationPage> {
  const res = await api.get('/api/user/notifications', { params })
  return requireServerSuccess(res.data).data as UserNotificationPage
}

export async function markNotificationsRead(ids: number[]): Promise<number> {
  const res = await api.post('/api/user/notifications/read', { ids })
  return (requireServerSuccess(res.data).data as { updated: number }).updated
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await api.post('/api/user/notifications/read_all')
  return (requireServerSuccess(res.data).data as { updated: number }).updated
}

export async function deleteNotifications(ids: number[]): Promise<number> {
  const res = await api.post('/api/user/notifications/delete', { ids })
  return (requireServerSuccess(res.data).data as { deleted: number }).deleted
}

/** onlyRead=true 只清已读（「清空已读」），false 清空全部（「清空全部」）。 */
export async function deleteNotificationsByScope(
  onlyRead: boolean
): Promise<number> {
  const res = await api.post('/api/user/notifications/delete_all', {
    only_read: onlyRead,
  })
  return (requireServerSuccess(res.data).data as { deleted: number }).deleted
}
