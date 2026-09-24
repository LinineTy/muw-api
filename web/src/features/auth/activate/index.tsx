// @muw-owned
/**
 * 激活页（激活制）：待激活账号提交邀请码转正。
 *
 * 提交链路（2026-09-24 定）：
 *   1. 先领一道人机校验（PoW）挑战 → 右上角浮窗里求解（Worker，不卡界面、不遮页面）；
 *   2. 带上 invite_code + challenge_id/nonce + 蜜罐字段提交；
 *   3. 服务端：蜜罐字段非空 ⇒ 直接判自动化并停用；PoW 未过 ⇒ 回机器码让前端重算；
 *      钓具码命中但 PoW 通过 ⇒ 判真人误踩，宽限记录当场结清（不会被到期停用）。
 *
 * 界面上另有一样东西不显眼但关键：表单里的隐形蜜罐字段（真人看不到、tab 不到），
 * 只有遍历表单的自动化脚本会填它。
 */
import { Loader2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  activateAccount,
  getActivationChallenge,
  getActivationDeadline,
} from '@/features/auth/api'
import { AUTH_INPUT, AUTH_MINOR_TEXT, AUTH_PRIMARY_BUTTON } from '@/features/auth/lib/auth-styles'
import { isAuthUser } from '@/lib/auth-session'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { AuthLayout } from '../auth-layout'
import { AuthCard } from '../components/auth-card'
import { ActivationVerifyWindow } from './components/activation-verify-window'
import { useActivationPow } from './lib/use-activation-pow'

/** 服务端回的人机校验机器码（见 controller/activation_pow.go）。 */
const CODE_VERIFICATION_REQUIRED = 'ACTIVATION_VERIFICATION_REQUIRED'
const CODE_VERIFICATION_FAILED = 'ACTIVATION_VERIFICATION_FAILED'

/** 挑战本身都拿不到（接口异常）：不提交、不惩罚，提示稍后重试。 */
class ChallengeUnavailableError extends Error {}

type ActivationProof = { challengeId: string; nonce: string }

/** 剩余秒数格式化成 m:ss，倒计时提示用。 */
function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function Activate() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.auth.setUser)
  const [inviteCode, setInviteCode] = useState('')
  // 隐形蜜罐：真人看不到也填不到，非空即自动化（服务端处置）。状态放在这里是为了
  // 让"脚本按字段名遍历表单"这件事在 DOM 与请求体里都成立。
  const [honeypot, setHoneypot] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [powBits, setPowBits] = useState(0)
  const pow = useActivationPow()
  // 解构出稳定的 solve 供 useCallback 依赖（直接依赖 pow 对象会每次渲染都变）。
  const solvePow = pow.solve
  const closeTimer = useRef<number | undefined>(undefined)

  // 提交过钓鱼邀请码的账号会有一条宽限记录（后端只读接口），据此显示倒计时：
  // 宽限期内用有效邀请码激活即免于停用。读不到就不提示，不阻断激活流程。
  const refreshDeadline = useCallback(async () => {
    try {
      const info = await getActivationDeadline()
      if (info.pending && info.remaining_seconds) {
        setDeadline(Date.now() + info.remaining_seconds * 1000)
        setRemaining(info.remaining_seconds)
        return
      }
    } catch {
      // 忽略：没有提示不影响激活本身
    }
    setDeadline(null)
    setRemaining(0)
  }, [])

  useEffect(() => {
    void refreshDeadline()
  }, [refreshDeadline])

  useEffect(() => {
    if (deadline === null) return
    const tick = () =>
      setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [deadline])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  // 领挑战 + 求解。返回 null = 本站未开启人机校验；挑战拿不到抛 ChallengeUnavailableError。
  const runVerification = useCallback(async (): Promise<ActivationProof | null> => {
    let challenge
    try {
      challenge = await getActivationChallenge()
    } catch {
      throw new ChallengeUnavailableError()
    }
    if (!challenge.enabled || !challenge.challenge || !challenge.bits) {
      return null
    }
    setPowBits(challenge.bits)
    setVerifyOpen(true)
    const nonce = await solvePow(challenge.challenge, challenge.bits)
    // 求解完让浮窗停在"校验通过"约 0.9 秒再自动关，用户也能自己关。
    closeTimer.current = window.setTimeout(() => setVerifyOpen(false), 900)
    return { challengeId: challenge.challenge_id ?? '', nonce }
  }, [solvePow])

  const submitOnce = useCallback(
    async (code: string) => {
      const proof = await runVerification()
      return activateAccount({
        inviteCode: code,
        website: honeypot,
        challengeId: proof?.challengeId,
        nonce: proof?.nonce,
      })
    },
    [honeypot, runVerification]
  )

  const submit = async (rawCode: string) => {
    const code = rawCode.trim()
    if (!code) {
      toast.error(t('Enter your invitation code'))
      return
    }
    setIsSubmitting(true)
    try {
      let res = await submitOnce(code)
      // 挑战一次性消费：过期/被换人时服务端会回机器码，这里自动再走一轮（最多一次）。
      if (
        res?.code === CODE_VERIFICATION_REQUIRED ||
        res?.code === CODE_VERIFICATION_FAILED
      ) {
        res = await submitOnce(code)
      }
      if (res?.success && isAuthUser(res.data)) {
        window.clearTimeout(closeTimer.current)
        setVerifyOpen(false)
        setUser(res.data)
        toast.success(t('Activated successfully'))
        navigate({ to: '/os-desktop', replace: true })
      } else {
        toast.error(res?.message || t('Activation failed'))
        // 失败后立刻重取一次：若这次提交的正是钓鱼码，提示当场出现（不用刷新页面）。
        void refreshDeadline()
      }
    } catch (error) {
      if (error instanceof ChallengeUnavailableError) {
        setVerifyOpen(false)
        toast.error(
          t('Security check is unavailable right now. Please try again later.')
        )
      }
      // 求解失败：浮窗已经是失败态，等用户点「重试」，不额外提示。
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit(inviteCode)
  }

  // 浮窗里的「重试」：清掉失败态，用同一个邀请码再跑一轮（重新领挑战）。
  const handleRetryVerification = () => {
    pow.reset()
    void submit(inviteCode)
  }

  return (
    <AuthLayout>
      <AuthCard
        title={t('Activate Account')}
        subtitle={t(
          'This site requires an invitation code to activate your account'
        )}
        badge='activate'
        badgeLabel={t('Activation required')}
        footer={
          <button
            type='button'
            onClick={() => navigate({ to: '/sign-in', replace: true })}
            className={cn(
              AUTH_MINOR_TEXT,
              'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('Sign in with a different account')}
          </button>
        }
      >
        <form onSubmit={handleSubmit} className='relative grid gap-4'>
          {/* 隐形蜜罐：真人看不到、tab 不到、读屏忽略；只有遍历表单的自动化会填。
              非空即由服务端判为自动化提交（立即停用），真人不会触发。 */}
          <input
            type='text'
            name='website_url'
            data-testid='activation-honeypot'
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
            tabIndex={-1}
            autoComplete='off'
            aria-hidden='true'
            className='pointer-events-none absolute -left-[9999px] top-0 h-0 w-0 opacity-0'
          />
          {deadline !== null ? (
            <p
              role='status'
              className='text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5'
            >
              {remaining > 0
                ? t(
                    'Your account will be disabled in {{time}} unless you activate with a valid invitation code.',
                    { time: formatCountdown(remaining) }
                  )
                : t(
                    'The activation deadline has passed; this account will be disabled shortly.'
                  )}
            </p>
          ) : null}
          <div className='grid gap-2'>
            <Label htmlFor='invite-code' className='sr-only'>
              {t('Invitation Code')}
            </Label>
            <Input
              id='invite-code'
              placeholder={t('Invitation Code')}
              className={AUTH_INPUT}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete='off'
              disabled={isSubmitting}
            />
          </div>
          <Button
            type='submit'
            disabled={isSubmitting}
            className={cn(AUTH_PRIMARY_BUTTON, 'mt-1')}
          >
            {isSubmitting ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
            {t('Activate')}
          </Button>
        </form>
      </AuthCard>
      <ActivationVerifyWindow
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        status={pow.status}
        hashes={pow.hashes}
        bits={powBits}
        onRetry={handleRetryVerification}
      />
    </AuthLayout>
  )
}
