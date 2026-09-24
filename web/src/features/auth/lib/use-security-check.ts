// @muw-owned
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getLoginChallenge, type ActivationChallenge } from '../api'
import { useActivationPow } from '../activate/lib/use-activation-pow'
import {
  onPreAuthProofConsumed,
  setPreAuthProof,
  type PreAuthProof,
} from './pre-auth-proof'
import type { SecurityCheckStatus } from '../components/security-check-window'

export type SecurityCheckState = {
  /** 用户是否已勾选（勾选后才开始校验；之后的重新校验不再要求再勾一次） */
  armed: boolean
  /** 校验通过，或本站未开启校验 */
  ready: boolean
  status: SecurityCheckStatus
  /** 交给 SecurityCheckWindow */
  windowProps: {
    open: boolean
    status: SecurityCheckStatus
    onStart: () => void
    onRetry: () => void
  }
  /** 其它入口点击时的守卫：未通过则提示并返回 false。 */
  guard: () => boolean
  /** 取到可用的凭据（正在计算时等待其完成）。 */
  ensureProof: () => Promise<PreAuthProof | null>
  /** 标记凭据已被本次提交用掉（服务端一次性），并按需重新校验。 */
  consumeProof: () => void
  /** 服务端回"需要重新校验"时调用。 */
  refresh: () => Promise<void>
}

type SecurityCheckOptions = {
  /** 凭据更新时的回调（调用方决定是否另存一份） */
  onProof?: (proof: PreAuthProof | null) => void
  /** 订阅"凭据已被取走"的通知（例如凭据由 api 层消费时） */
  subscribeConsumed?: (listener: () => void) => () => void
}

/**
 * 通用校验流程：用户勾选后领取挑战并计算，通过后由调用方取用凭据。
 *
 * 服务端才是校验关口（激活提交、登录/注册、第三方登录的 state 签发都会校验凭据）。
 * 求解失败与接口异常都不放行，也不做惩罚，用户可重试。
 */
export function useSecurityCheck(
  fetchChallenge: () => Promise<ActivationChallenge>,
  options: SecurityCheckOptions = {}
): SecurityCheckState {
  const { onProof, subscribeConsumed } = options
  const { t } = useTranslation()
  const pow = useActivationPow()
  const solvePow = pow.solve
  const [armed, setArmed] = useState(false)
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(true)
  const proofRef = useRef<PreAuthProof | null>(null)
  const pendingRef = useRef<Promise<void> | null>(null)
  const mountedRef = useRef(true)
  const armedRef = useRef(false)

  const run = useCallback(async (): Promise<void> => {
    if (pendingRef.current) {
      return pendingRef.current
    }
    setReady(false)
    proofRef.current = null
    onProof?.(null)
    const task = (async () => {
      try {
        const challenge = await fetchChallenge()
        if (!challenge.enabled || !challenge.challenge || !challenge.bits) {
          // 未开启校验：直接放行
          if (mountedRef.current) {
            setOpen(false)
            setReady(true)
          }
          return
        }
        if (mountedRef.current) {
          setOpen(true)
        }
        const nonce = await solvePow(challenge.challenge, challenge.bits)
        const proof = { challengeId: challenge.challenge_id ?? '', nonce }
        proofRef.current = proof
        onProof?.(proof)
        if (mountedRef.current) {
          setReady(true)
        }
      } catch {
        // 求解失败或接口异常：不放行，也不惩罚，用户可重试
        if (mountedRef.current) {
          setReady(false)
          proofRef.current = null
          onProof?.(null)
        }
      }
    })()
    pendingRef.current = task
    try {
      await task
    } finally {
      pendingRef.current = null
    }
  }, [fetchChallenge, onProof, solvePow])

  const start = useCallback(() => {
    armedRef.current = true
    setArmed(true)
    void run()
  }, [run])

  const retry = useCallback(() => {
    pow.reset()
    void run()
  }, [pow, run])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!subscribeConsumed) {
      return
    }
    return subscribeConsumed(() => {
      if (armedRef.current) {
        void run()
      }
    })
  }, [run, subscribeConsumed])

  /** 等待正在进行的计算，然后交出凭据（交出即作废，按需重算下一份）。 */
  const ensureProof = useCallback(async (): Promise<PreAuthProof | null> => {
    if (pendingRef.current) {
      await pendingRef.current
    }
    const proof = proofRef.current
    proofRef.current = null
    onProof?.(null)
    if (armedRef.current) {
      void run()
    }
    return proof
  }, [onProof, run])

  const guard = useCallback(() => {
    if (ready) {
      return true
    }
    toast.error(t('Security check failed. Please try again.'))
    return false
  }, [ready, t])

  const consumeProof = useCallback(() => {
    proofRef.current = null
    onProof?.(null)
    if (armedRef.current) {
      void run()
    }
  }, [onProof, run])

  return {
    armed,
    ready,
    status: pow.status,
    windowProps: {
      open,
      status: pow.status,
      onStart: start,
      onRetry: retry,
    },
    guard,
    ensureProof,
    consumeProof,
    refresh: run,
  }
}

/** 登录、注册、第三方登录入口的前置校验（挑战来自 /api/user/login_challenge）。 */
export function usePreAuthCheck(enabled = true): SecurityCheckState {
  const fetchChallenge = useCallback(async () => {
    if (!enabled) {
      return { enabled: false } as ActivationChallenge
    }
    return getLoginChallenge()
  }, [enabled])

  const check = useSecurityCheck(fetchChallenge, {
    onProof: setPreAuthProof,
    subscribeConsumed: onPreAuthProofConsumed,
  })

  return enabled ? check : { ...check, ready: true }
}
