// @muw-owned
import { Menu, X } from 'lucide-react'

import { useSidebar } from '@/components/ui/sidebar'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

/**
 * 移动端导航悬浮球(参考 cdk-tools 的 FAB 交互):
 * - 常驻右下角,点击弹出侧栏导航卡(ui/sidebar.tsx 的 FAB 弹卡分支)
 * - 打开后旋转 90°、圆变圆角方形,图标 汉堡 → ×
 * - 桌面端(≥768px)不渲染
 *
 * 观感走主题 token(bg-popover + backdrop-blur/saturate):琉璃主题下与
 * 面板配方同款半透明玻璃,透出背景;默认主题下 popover 为实色,呈现常规球。
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
        'bg-popover text-primary border-border/60 fixed right-6 bottom-6 z-[70] flex size-12 items-center justify-center border shadow-[0_8px_24px_rgba(0,0,0,0.15)] backdrop-blur saturate-150',
        'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        'hover:scale-[1.08] active:scale-95',
        openMobile ? 'rotate-90 rounded-lg' : 'rounded-full'
      )}
    >
      {openMobile ? (
        <X className='size-5' aria-hidden='true' />
      ) : (
        <Menu className='size-5' aria-hidden='true' />
      )}
    </button>
  )
}
