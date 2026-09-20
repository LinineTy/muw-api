// @muw-owned

/** 站内消息（后端 model.UserNotification）。正文是纯文本台账，按 pre-wrap 渲染。 */
export interface UserNotificationItem {
  id: number
  user_id: number
  type: string
  title: string
  content: string
  created_at: number
  /** 0 = 未读 */
  read_at: number
}

export interface UserNotificationPage {
  items: UserNotificationItem[]
  total: number
  /** 未读数：始终是「全部未读」，不受 unread_only 影响 */
  unread: number
  page: number
  page_size: number
}
