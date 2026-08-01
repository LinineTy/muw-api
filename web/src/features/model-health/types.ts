/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export type TestTrendPoint = {
  created_at: number
  response_time: number
  success: boolean
}

export type ModelHealthRow = {
  channel_id: number
  channel_name: string
  model_name: string
  test_count: number
  success_count: number
  success_rate: number
  avg_response_time: number
  last_response_time: number
  last_test_time: number
  last_error: string
  trend: TestTrendPoint[]
  user_traffic_count?: number
}

export type ChannelTestRecord = {
  id: number
  channel_id: number
  channel_name: string
  model_name: string
  success: boolean
  response_time: number
  error_reason: string
  source?: string
  created_at: number
}

export type ModelHealthParams = {
  days?: number
  channel_id?: number
  q?: string
  unhealthy?: boolean
}

export type ChannelTestRecordsParams = {
  channel_id: number
  model?: string
  page?: number
  page_size?: number
}

export type ChannelTestRecordsResult = {
  records: ChannelTestRecord[]
  total: number
}
