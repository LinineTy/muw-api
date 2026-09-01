// @muw-owned
import { useEffect, useState } from 'react'

import { useStatus } from '@/hooks/use-status'
import { getNotice } from '@/lib/api'

const NOTICE_CLOSE_DATE_KEY = 'notice_close_date'
const NOTICE_CLOSE_HASH_KEY = 'notice_close_hash'

const DEFAULT_COUNTDOWN_SECONDS = 5

/**
 * Stable content fingerprint of the system notice. Used so the popup
 * reappears when the notice text changes, even if it was already dismissed
 * for today.
 */
export function hashNotice(content: string): string {
  let hash = 0
  if (!content) return '0'

  for (let i = 0; i < content.length; i += 1) {
    const chr = content.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}

/**
 * Whether the popup was already dismissed for today, regardless of content.
 * Legacy key kept for backward compatibility with the old date-only behavior.
 */
export function isNoticeClosedToday(): boolean {
  const lastCloseDate = localStorage.getItem(NOTICE_CLOSE_DATE_KEY)
  const today = new Date().toDateString()
  return lastCloseDate === today
}

/** Dismiss the popup for today, remembering the dismissed notice content. */
export function closeNoticeForToday(notice: string): void {
  localStorage.setItem(NOTICE_CLOSE_DATE_KEY, new Date().toDateString())
  localStorage.setItem(NOTICE_CLOSE_HASH_KEY, hashNotice(notice))
}

/**
 * Whether the popup should be shown for the given notice content:
 * shown when it was not dismissed today, or the notice text changed since it
 * was last dismissed.
 */
export function shouldShowNoticePopup(notice: string): boolean {
  const lastCloseDate = localStorage.getItem(NOTICE_CLOSE_DATE_KEY)
  const lastCloseHash = localStorage.getItem(NOTICE_CLOSE_HASH_KEY)
  const today = new Date().toDateString()
  return lastCloseDate !== today || lastCloseHash !== hashNotice(notice)
}

/**
 * Auto-open the system-notice popup on the landing page when:
 * 1. the `announcement_popup_enabled` setting is on (default on), and
 * 2. the `/api/notice` payload (System Notice) is non-empty, and
 * 3. it was not dismissed today, or the notice text has changed since.
 */
export function useAnnouncementDialog() {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const { status } = useStatus()
  const popupEnabled = status?.announcement_popup_enabled !== false
  const countdownSeconds =
    typeof status?.announcement_popup_duration === 'number'
      ? status.announcement_popup_duration
      : DEFAULT_COUNTDOWN_SECONDS

  useEffect(() => {
    if (!popupEnabled) {
      return
    }

    let cancelled = false
    getNotice()
      .then((res) => {
        if (cancelled || !res.success || !res.data || !res.data.trim()) {
          return
        }
        const content = res.data
        if (!shouldShowNoticePopup(content)) {
          return
        }
        setNotice(content)
        setOpen(true)
      })
      .catch(() => {
        // Ignore network failures; the popup simply stays hidden.
      })

    return () => {
      cancelled = true
    }
  }, [popupEnabled])

  const dismiss = (hideToday: boolean) => {
    if (hideToday) {
      closeNoticeForToday(notice)
    }
    setOpen(false)
  }

  return { open, setOpen, notice, dismiss, countdownSeconds }
}
