// @muw-owned
import { Menu, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { useSidebar } from '@/components/ui/sidebar'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

/**
 * 移动端导航悬浮球(参考 cdk-tools 的 FAB 交互):
 * - 默认右下角,点击弹出侧栏导航卡(ui/sidebar.tsx 的 FAB 弹卡分支)
 * - **可拖动**:按住拖动到任意位置,松手后位置记进 localStorage,下次进来还在那儿
 *   (存量问题:球固定在右下角时会压住列表底部的分页控件;拖动一次即可永久避开)
 * - 拖动与点击的区分:位移超过 6px 才算拖动,之后的 click 事件被吞掉,不会误开导航卡
 * - 打开后旋转 90°、圆变圆角方形,图标 汉堡 → ×
 * - 桌面端(≥768px)不渲染
 *
 * 观感走主题 token(bg-popover + backdrop-blur/saturate):琉璃主题下与
 * 面板配方同款半透明玻璃,透出背景;默认主题下 popover 为实色,呈现常规球。
 *
 * z-[70] 高于弹卡(z-60)与遮罩(z-[59]),打开态仍可点击关闭。
 */

/** 球体边长(与 size-12 一致)/ 与视口边缘的最小间距 */
const BALL_SIZE = 48
const EDGE_MARGIN = 8
/** 位移超过该距离才算拖动,否则按点击处理 */
const DRAG_THRESHOLD = 6
const STORAGE_KEY = 'muw:mobile-nav-fab-offset'

type Offset = { right: number; bottom: number }

/** 把位置夹回可视区(旋转屏幕 / 换设备后回到过得去的地方) */
function clampOffset(offset: Offset): Offset {
  const maxRight = Math.max(
    EDGE_MARGIN,
    window.innerWidth - BALL_SIZE - EDGE_MARGIN
  )
  const maxBottom = Math.max(
    EDGE_MARGIN,
    window.innerHeight - BALL_SIZE - EDGE_MARGIN
  )
  return {
    right: Math.min(Math.max(offset.right, EDGE_MARGIN), maxRight),
    bottom: Math.min(Math.max(offset.bottom, EDGE_MARGIN), maxBottom),
  }
}

/** 读取记忆位置;没有记忆或数据不合法都返回 null(保持默认右下角) */
function readStoredOffset(): Offset | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Offset> | null
    if (
      typeof parsed?.right !== 'number' ||
      typeof parsed?.bottom !== 'number' ||
      !Number.isFinite(parsed.right) ||
      !Number.isFinite(parsed.bottom)
    ) {
      return null
    }
    return clampOffset({ right: parsed.right, bottom: parsed.bottom })
  } catch {
    return null
  }
}

function storeOffset(offset: Offset) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(offset))
  } catch {
    // 隐私模式 / 存储被禁用时静默忽略:位置不记忆,功能不受影响
  }
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  startOffset: Offset
  moved: boolean
}

export function MobileNavFab() {
  const isMobile = useIsMobile()
  const { openMobile, setOpenMobile } = useSidebar()
  /** null = 用默认位置(右下角 24px),首次拖动后才有值 */
  const [offset, setOffset] = useState<Offset | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragState = useRef<DragState | null>(null)
  const latestOffset = useRef<Offset | null>(null)
  const suppressClick = useRef(false)

  // 恢复记忆位置
  useEffect(() => {
    if (!isMobile) return
    const stored = readStoredOffset()
    if (stored) {
      latestOffset.current = stored
      setOffset(stored)
    }
  }, [isMobile])

  // 视口变化后夹回可视区
  useEffect(() => {
    if (!offset) return
    const handleResize = () => {
      setOffset((prev) => {
        if (!prev) return prev
        const next = clampOffset(prev)
        latestOffset.current = next
        return next
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [offset])

  if (!isMobile) return null

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset ?? {
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
      },
      moved: false,
    }
    try {
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    } catch {
      // 环境不支持指针捕获时退化为普通拖动(不阻断点击)
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      state.moved = true
      setIsDragging(true)
    }
    const next = clampOffset({
      right: state.startOffset.right - dx,
      bottom: state.startOffset.bottom - dy,
    })
    latestOffset.current = next
    setOffset(next)
  }

  const handlePointerEnd = () => {
    const state = dragState.current
    dragState.current = null
    setIsDragging(false)
    if (!state?.moved) return
    // 拖动结束:吞掉随后那次 click,并记住位置
    suppressClick.current = true
    if (latestOffset.current) storeOffset(latestOffset.current)
  }

  const handleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    setOpenMobile(!openMobile)
  }

  return (
    <button
      type='button'
      aria-label='Toggle Sidebar'
      aria-expanded={openMobile}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      style={
        offset
          ? { right: offset.right, bottom: offset.bottom, touchAction: 'none' }
          : { touchAction: 'none' }
      }
      className={cn(
        'bg-popover text-primary border-border/60 fixed z-[70] flex size-12 items-center justify-center border shadow-[0_8px_24px_rgba(0,0,0,0.15)] backdrop-blur saturate-150',
        !offset && 'right-6 bottom-6',
        isDragging
          ? 'cursor-grabbing'
          : 'cursor-grab transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.08] active:scale-95',
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
