// @muw-owned
export interface IpUserRankRow {
  user_id: number
  username: string
  display_name: string
  status: number
  ip_count: number
  request_count: number
  last_seen: number
}

export interface IpRankRow {
  ip: string
  user_count: number
  request_count: number
  last_seen: number
  /** 离线归属地（形如 "中国 浙江省 杭州市 移动"）；库不可用时为空串 */
  location?: string
}

export interface UserIpDetailRow {
  ip: string
  request_count: number
  first_seen: number
  last_seen: number
  /** 离线归属地；归并模式下是该 /64 前缀的归属地 */
  location?: string
}

export interface IpUserDetailRow {
  user_id: number
  username: string
  display_name: string
  status: number
  request_count: number
  first_seen: number
  last_seen: number
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

/** 用户 IP 数分布的一个分桶（bucket 是后端固定的五档之一）。 */
export interface IpAnalysisBucketRow {
  bucket: string
  users: number
}

/** 风控看板概览指标。 */
export interface IpAnalysisOverview {
  total_ips: number
  total_users: number
  avg_ips_per_user: number
  shared_ips: number
  risky_users: number
  v6_percent: number
  distribution: IpAnalysisBucketRow[]
}

/** 单日独立 IP 数（day_idx 语义同运营趋势）。 */
export interface IpAnalysisTrendRow {
  day_idx: number
  ips: number
}

/** 一对账号的时段重合统计（判据见后端 GetIpOverlapPairs 注释）。 */
export interface IpOverlapRow {
  user_id_a: number
  username_a: string
  active_a: number
  user_id_b: number
  username_b: string
  active_b: number
  overlap: number
  expected: number
  ratio: number
}
