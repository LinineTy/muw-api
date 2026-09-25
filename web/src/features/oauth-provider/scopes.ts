// @muw-owned
// 同意页与申请页共享的 scope 文案（key 即英文原文，翻译在 locales 里）。
export const SUPPORTED_SCOPES = [
  'openid',
  'profile',
  'email',
  'group',
  'offline_access',
] as const

export const SCOPE_LABELS: Record<string, string> = {
  openid: 'Confirm that you are signed in to this site',
  profile: 'Read your username, display name and avatar',
  email: 'Read your email address',
  group: 'Read your group and subscription tier',
  offline_access:
    'Keep access while the application refreshes it in the background',
}
