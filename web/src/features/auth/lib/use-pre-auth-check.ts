// @muw-owned
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getLoginChallenge } from '../api'
import {
  onPreAuthProofConsumed,
  setPreAuthProof,
  takePreAuthProof,
} from './pre-auth-proof'
import { useActivationPow } from '../activate/lib/use-activation-pow'

export type PreAuthCheckState = {
  /** true = 校验已通过（或本站未开启校验），可以提交 */
  ready: boolean
  /** 浮窗要的属性，交给 ActivationVerifyWindow */
  windowProps: {
    open: boolean
    onOpenChange: (open: boolean) => void
    status: 'idle' | 'solving' | 'done' | 'failed'
    hashes: number
    bits: number
    onRetry: () => void
  }
  /** 其它入口（第三方登录按钮）点击时的守卫：没过就给提示并重算，返回 false。 */
  guard: () => boolean
  /** 记下这次提交用掉的凭据：服务端一次性消费，所以客户端同拍重算。 */
  consumeProof: () => void
  /** 服务端回"需要重新校验"时调用（随后重试一次）。 */
  refresh: () => Promise<void>
}

/**
 * 登录/注册/第三方登录入口的前置人机校验。
 *
 * 服务端是真正的关口（登录接口与第三方登录的 state 签发都校验挑战），这里做的是
 * 体验层：进页面就把挑战算好，没过之前按钮不给按 / 点了提示"环境检查失败"。
 * 校验关闭（开关关或难度 0）时立刻 ready=true，不打扰任何人。
 */
export function usePreAuthCheck(enabled = true): PreAuthCheckState {
  const { t } = useTranslation()
  const pow = useActivationPow()
  const solvePow = pow.solve
  const [ready, setReady] = useState(!enabled)
  const [bits, setBits] = useState(0)
  const [open, setOpen] = useState(false)
  const solvingRef = useRef(false)
  const mountedRef = useRef(true)

  const start = useCallback(async () => {
    if (!enabled || solvingRef.current) {
      return
    }
    solvingRef.current = true
    setReady(false)
    setPreAuthProof(null)
    try {
      const challenge = await getLoginChallenge()
      if (!challenge.enabled || !challenge.challenge || !challenge.bits) {
        // 本站没开校验（或难度为 0）：直接放行
        if (mountedRef.current) setReady(true)
        return
      }
      if (mountedRef.current) {
        setBits(challenge.bits)
        setOpen(true)
      }
      const nonce = await solvePow(challenge.challenge, challenge.bits)
      setPreAuthProof({ challengeId: challenge.challenge_id ?? '', nonce })
      if (mountedRef.current) {
        setReady(true)
        // 让"校验通过"停一下再收窗，用户也能自己关
        window.setTimeout(() => setOpen(false), 900)
      }
    } catch {
      // 求解失败/接口不可用：浮窗会显示失败态或保持关闭；此时不能放行，
      // 但也不做任何惩罚 —— 用户点重试或刷新即可。
      if (mountedRef.current) {
        setReady(false)
        setPreAuthProof(null)
      }
    } finally {
      solvingRef.current = false
    }
  }, [enabled, solvePow])

  const retry = useCallback(() => {
    pow.reset()
    void start()
  }, [pow, start])

  useEffect(() => {
    mountedRef.current = true
    void start()
    return () => {
      mountedRef.current = false
    }
  }, [start])

  // 凭据被消费（提交过一次）⇒ 服务端已经把它作废，立刻重算下一道。
  useEffect(() => onPreAuthProofConsumed(() => void start()), [start])

  // 第三方登录等入口点击时的守卫：没过就给提示并（重新）开始算，返回 false 表示别继续。
  const guard = useCallback(() => {
    if (ready) {
      return true
    }
    toast.error(t('Security check failed. Please try again.'))
    void start()
    return false
  }, [ready, start, t])

  const consumeProof = useCallback(() => {
    if (takePreAuthProof()) {
      setReady(false)
    }
  }, [])

  return {
    ready,
    windowProps: {
      open,
      onOpenChange: setOpen,
      status: pow.status,
      hashes: pow.hashes,
      bits,
      onRetry: retry,
    },
    guard,
    consumeProof,
    refresh: start,
  }
}
