// @muw-owned
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActivationGuardSection } from '../activation-guard-section'
import {
  MAX_POW_BITS,
  MIN_GRACE_SECONDS,
  pickChangedActivationGuardOptions,
} from '../activation-guard'

vi.mock('../../hooks/use-update-option', () => ({
  useUpdateOption: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const defaults = {
  PoWChallengeBits: 20,
  InviteTrapGraceSeconds: 900,
  ActivationHoneypotEnabled: true,
}

describe('激活防护设置页', () => {
  it('边界常量与后端一致（改了要两边一起改）', () => {
    // 后端：common.MaxActivationPoWBits / common.MinInviteTrapGraceSeconds
    expect(MAX_POW_BITS).toBe(24)
    expect(MIN_GRACE_SECONDS).toBe(60)
  })

  it('只提交改动过的项，没动的一个都不回写', () => {
    expect(pickChangedActivationGuardOptions(defaults, defaults)).toEqual([])
    expect(
      pickChangedActivationGuardOptions(
        { ...defaults, PoWChallengeBits: 22 },
        defaults
      )
    ).toEqual([{ key: 'PoWChallengeBits', value: 22 }])
    expect(
      pickChangedActivationGuardOptions(
        { ...defaults, ActivationHoneypotEnabled: false },
        defaults
      )
    ).toEqual([{ key: 'ActivationHoneypotEnabled', value: false }])
    expect(
      pickChangedActivationGuardOptions(
        {
          PoWChallengeBits: 0,
          InviteTrapGraceSeconds: 300,
          ActivationHoneypotEnabled: false,
        },
        defaults
      )
    ).toEqual([
      { key: 'PoWChallengeBits', value: 0 },
      { key: 'InviteTrapGraceSeconds', value: 300 },
      { key: 'ActivationHoneypotEnabled', value: false },
    ])
  })

  it('渲染三个人机/自动化相关控件', () => {
    render(<ActivationGuardSection defaultValues={defaults} />)
    expect(screen.getByText('Proof-of-work difficulty')).toBeInTheDocument()
    expect(
      screen.getByText('Trap code grace period (seconds)')
    ).toBeInTheDocument()
    expect(screen.getByText('Hidden honeypot field')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeInTheDocument()
    // 三个数值输入：难度 / 宽限秒数（都是 number 输入）
    const numbers = document.querySelectorAll('input[type="number"]')
    expect(numbers).toHaveLength(2)
    expect((numbers[0] as HTMLInputElement).value).toBe('20')
    expect((numbers[1] as HTMLInputElement).value).toBe('900')
  })
})
