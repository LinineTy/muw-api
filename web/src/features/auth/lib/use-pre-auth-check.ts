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
  /** 其它入口点击时的守卫：未通过则提示并重算。 */
  guard: () => boolean
  /** 标记凭据已被本次提交用掉（服务端一次性）。 */
  consumeProof: () => void
  /** 服务端回"需要重新校验"时调用。 */
  refresh: () => Promise<void>
}

/**
 * 登录、注册与第三方登录入口的前置校验（体验层）。
 *
 * 服务端才是校验关口（登录接口与第三方登录的 state 签发都会校验）；这里负责
 * 进页面即开始计算，未通过前不放行提交。校验关闭时立即 ready。
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
        // 未开启校验：直接放行
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
        // 通过状态停留一下再收起
        window.setTimeout(() => setOpen(false), 900)
      }
    } catch {
      // 求解失败或接口不可用：不放行，也不做惩罚，用户重试即可。
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

  // 凭据已被服务端消费：立即重算下一道。
  useEffect(() => onPreAuthProofConsumed(() => void start()), [start])

  // 其它入口点击时的守卫：未通过则提示并重新计算，返回 false 表示不要继续。
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
