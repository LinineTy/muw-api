// @muw-owned
export interface OperationsOverview {
  total_users: number
  new_users_today: number
  new_users_7d: number
  active_today: number
  active_7d: number
  requests_today: number
  quota_today: number
  disabled_users: number
}

export interface OperationsTrendRow {
  day_idx: number
  new_users: number
  active_users: number
  requests: number
  quota: number
}

export interface DistributionRow {
  key: string
  count: number
}

export interface TrustLevelRow {
  /** null = 该用户的信任等级从未同步过（linux_do_trust_level 为 NULL） */
  level: number | null
  count: number
}

export interface OperationsDistributions {
  sources: DistributionRow[]
  trust_levels: TrustLevelRow[]
  groups: DistributionRow[]
}

export interface OperationsRankingRow {
  key: string
  name: string
  requests: number
  quota: number
  users: number
}

export interface OperationsRankings {
  models: OperationsRankingRow[]
  channels: OperationsRankingRow[]
}

export const SOURCE_LABEL_KEYS: Record<string, string> = {
  linuxdo: 'LinuxDO',
  github: 'GitHub',
  wechat: 'WeChat',
  telegram: 'Telegram',
  oidc: 'OIDC',
  email: 'Email',
}
