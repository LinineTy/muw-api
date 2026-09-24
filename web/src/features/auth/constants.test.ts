// @muw-owned
import { describe, expect, it } from 'vitest'

import { registerFormSchema } from './constants'

const parseEmail = (email?: string) =>
  registerFormSchema.safeParse({
    username: 'someone',
    email,
    password: 'Abcd1234!',
    confirmPassword: 'Abcd1234!',
  })

describe('registerFormSchema 的邮箱字段', () => {
  it('不填 / 空串都合法（邮箱只在开启邮件验证时必填）', () => {
    expect(parseEmail(undefined).success).toBe(true)
    expect(parseEmail('').success).toBe(true)
  })

  it('填了就必须是邮箱格式（不再靠提交时 toast 兜底）', () => {
    const bad = parseEmail('not-an-email')
    expect(bad.success).toBe(false)
    expect(
      bad.error?.issues.some((issue) => issue.path[0] === 'email')
    ).toBe(true)
  })

  it('正常邮箱通过', () => {
    expect(parseEmail('someone@example.com').success).toBe(true)
  })
})
