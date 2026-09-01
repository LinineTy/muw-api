// @muw-owned
import { ExternalLink, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface RedemptionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRedeem: (code: string) => Promise<boolean>
  redeeming: boolean
  topupLink?: string
}

// 兑换码弹窗：由余额卡右上角「兑换码」按钮打开，替代原充值表单内联兑换区。
export function RedemptionDialog({
  open,
  onOpenChange,
  onRedeem,
  redeeming,
  topupLink,
}: RedemptionDialogProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCode('')
    }
  }, [open])

  const handleConfirm = async () => {
    const success = await onRedeem(code)
    if (success) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Redeem Code')}
      description={t('Enter your redemption code')}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      titleClassName='text-xl font-semibold'
      footerClassName='grid grid-cols-2 gap-2 sm:flex'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={redeeming}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={redeeming || !code.trim()}
          >
            {redeeming && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('Redeem')}
          </Button>
        </>
      }
    >
      <div className='space-y-4 py-3 sm:space-y-6 sm:py-4'>
        <div className='space-y-2'>
          <Label
            htmlFor='redemption-code-input'
            className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
          >
            {t('Redemption Code')}
          </Label>
          <Input
            id='redemption-code-input'
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConfirm()
            }}
            placeholder={t('Enter your redemption code')}
            className='h-9 font-mono'
          />
        </div>
        {topupLink && (
          <p className='text-muted-foreground text-xs'>
            {t('Need a redemption code?')}{' '}
            <a
              href={topupLink}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex items-center gap-1 underline-offset-4 hover:underline'
            >
              {t('Get one here')}
              <ExternalLink className='h-3 w-3' />
            </a>
          </p>
        )}
      </div>
    </Dialog>
  )
}
