// @muw-owned
// 激活防护设置页的边界常量与"只提交改动项"的比对。
// 上限/下限需与后端一致：common.MaxActivationPoWBits、common.MinInviteTrapGraceSeconds。
export const MAX_POW_BITS = 24
export const MIN_GRACE_SECONDS = 60

export type ActivationGuardValues = {
  PoWChallengeBits: number
  InviteTrapGraceSeconds: number
  ActivationHoneypotEnabled: boolean
  LoginChallengeEnabled: boolean
}

export const ACTIVATION_GUARD_KEYS = [
  'PoWChallengeBits',
  'InviteTrapGraceSeconds',
  'ActivationHoneypotEnabled',
  'LoginChallengeEnabled',
] as const

/** 挑出与默认值不同的项：保存是逐项 `PUT /api/option/`，只提交改动过的键。 */
export function pickChangedActivationGuardOptions(
  values: ActivationGuardValues,
  defaults: ActivationGuardValues
): Array<{ key: keyof ActivationGuardValues; value: number | boolean }> {
  return ACTIVATION_GUARD_KEYS.filter(
    (key) => values[key] !== defaults[key]
  ).map((key) => ({ key, value: values[key] }))
}
