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
