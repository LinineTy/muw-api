// @muw-owned
/**
 * 「激活防护」设置页的纯逻辑：边界常量与"只提交改动项"的比对。
 *
 * ⚠️ 这两个上限/下限必须与后端常量一致（改了要一起改）：
 *   `MAX_POW_BITS` ↔ `common.MaxActivationPoWBits`
 *   `MIN_GRACE_SECONDS` ↔ `common.MinInviteTrapGraceSeconds`
 * 由 `security/__tests__/activation-guard.test.ts` 兜底断言。
 */
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

/**
 * 挑出与默认值不同的项：设置页保存是逐项 `PUT /api/option/`，
 * 回写没动过的键既多余、又有被别处并发修改后覆盖的风险。
 */
export function pickChangedActivationGuardOptions(
  values: ActivationGuardValues,
  defaults: ActivationGuardValues
): Array<{ key: keyof ActivationGuardValues; value: number | boolean }> {
  return ACTIVATION_GUARD_KEYS.filter(
    (key) => values[key] !== defaults[key]
  ).map((key) => ({ key, value: values[key] }))
}
