// @muw-owned
import { Menu, X } from 'lucide-react'

import { useSidebar } from '@/components/ui/sidebar'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

/**
 * 移动端导航悬浮球(参考 cdk-tools 的 FAB 交互):
 * - 常驻右下角,圆形;点击弹出侧栏导航卡(ui/sidebar.tsx 的 FAB 弹卡分支)
 * - 打开后旋转 90°、圆变圆角方形,图标 汉堡 → ×
 * - 桌面端(≥768px)不渲染
 *
 * z-[70] 高于弹卡(z-60)与遮罩(z-[59]),打开态仍可点击关闭。
 */
export function MobileNavFab() {
  const isMobile = useIsMobile()
  const { openMobile, setOpenMobile } = useSidebar()

  if (!isMobile) return null

  return (
    <button
      type='button'
      aria-label='Toggle Sidebar'
      aria-expanded={openMobile}
      onClick={() => setOpenMobile(!openMobile)}
      className={cn(
        'bg-primary text-primary-foreground fixed right-6 bottom-7 z-[70] flex size-[3.25rem] items-center justify-center shadow-[0_4px_20px_rgba(0,0,0,0.25)]',
        'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        'hover:scale-[1.08] active:scale-95',
        openMobile ? 'rotate-90 rounded-xl' : 'rounded-full'
      )}
    >
      {openMobile ? (
        <X className='size-[1.375rem]' aria-hidden='true' />
      ) : (
        <Menu className='size-[1.375rem]' aria-hidden='true' />
      )}
    </button>
  )
}
