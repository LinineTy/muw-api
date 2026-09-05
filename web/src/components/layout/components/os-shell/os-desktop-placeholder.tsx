// @muw-owned
import { useTranslation } from 'react-i18next'

import { SystemBrand } from '../system-brand'

/**
 * OS 桌面壳 · 空桌面态:
 * 窗口被关闭(红点)后显示,提示从 Dock 或左下角导航球重新打开页面。
 * 路由变化(点击 Dock/导航球)时窗口自动重开。
 */
export function OsDesktopPlaceholder() {
  const { t } = useTranslation()

  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-4'>
      <div className='opacity-80'>
        <SystemBrand variant='inline' />
      </div>
      <p className='text-muted-foreground/70 max-w-xs text-center text-sm'>
        {t('os-shell.desktop-hint', '所有窗口已关闭 · 从底部 Dock 或左下角导航球打开页面')}
      </p>
    </div>
  )
}
