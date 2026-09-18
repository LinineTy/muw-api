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
}

export interface UserIpDetailRow {
  ip: string
  request_count: number
  first_seen: number
  last_seen: number
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
