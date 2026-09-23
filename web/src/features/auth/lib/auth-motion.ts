// @muw-owned
import { useReducedMotion } from 'motion/react'

import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'

/**
 * 认证页统一的入场动效（淡入 + 轻微上浮），delay 用于让标题区先落、主卡随后跟上。
 * 系统开启「减少动效」时整体关掉（返回空 props）。
 */
export function useAuthEnter(delay = 0) {
  const shouldReduce = useReducedMotion()

  if (shouldReduce) {
    return {}
  }

  return {
    initial: MOTION_VARIANTS.pageEnter.initial,
    animate: MOTION_VARIANTS.pageEnter.animate,
    transition: { ...MOTION_TRANSITION.fast, delay },
  }
}

/**
 * 收束页离开动效：先淡出、再跳转（跳转目标页自己没有入场过渡，硬切很生硬）。
 * 系统开启「减少动效」时返回 null，调用方立即跳转。
 */
export function useAuthLeave(durationMs = 200) {
  const shouldReduce = useReducedMotion()

  if (shouldReduce) {
    return null
  }

  return {
    durationMs,
    opacity: { duration: durationMs / 1000, ease: 'easeInOut' as const },
  }
}
