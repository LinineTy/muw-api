// @muw-owned
import { Megaphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

const NOTICE_COUNTDOWN_SECONDS = 5

interface AnnouncementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notice: string
  /**
   * Fired when the user confirms. `hideToday` is true when the "don't show
   * again today" checkbox is checked at dismissal time.
   */
  onDismiss: (hideToday: boolean) => void
  /**
   * Seconds both actions stay disabled after the popup opens (default 5,
   * 0 disables the countdown). Mirrors the legacy fullscreen-notice design.
   */
  countdownSeconds?: number
}

/**
 * Full-screen system-notice popup shown on the landing page.
 * Mirrors the legacy NoticeModal: auto-opens, both actions are gated behind a
 * countdown, and "don't show again today" is an explicit checkbox.
 */
export function AnnouncementDialog({
  open,
  onOpenChange,
  notice,
  onDismiss,
  countdownSeconds = NOTICE_COUNTDOWN_SECONDS,
}: AnnouncementDialogProps) {
  const { t } = useTranslation()
  const [countdown, setCountdown] = useState(countdownSeconds)
  const [hideToday, setHideToday] = useState(true)
  const ready = countdown <= 0

  useEffect(() => {
    if (!open) {
      setCountdown(countdownSeconds)
      setHideToday(true)
      return
    }
    if (countdown <= 0) {
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [open, countdown, countdownSeconds])

  // While the countdown runs, block closing via backdrop/Escape/close button.
  const handleOpenChange = (next: boolean) => {
    if (!next && !ready) {
      return
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Megaphone className='size-4' />
            {t('System Announcements')}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className='max-h-[60vh] pr-3'>
          <RichContent breaks content={notice} />
        </ScrollArea>
        <DialogFooter>
          <div className='flex items-center gap-2 text-sm'>
            <Checkbox
              checked={hideToday}
              onCheckedChange={(checked) => setHideToday(checked === true)}
              id='announcement-hide-today'
            />
            <label htmlFor='announcement-hide-today'>
              {t('Hide for Today')}
            </label>
          </div>
          <Button
            variant='outline'
            onClick={() => onDismiss(hideToday)}
            disabled={!ready}
          >
            {ready
              ? t('Got it')
              : t('Got it ({{count}}s)', { count: countdown })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
