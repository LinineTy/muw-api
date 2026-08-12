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

// 营销页主题 = 一份完整的 HTML 文档字符串,渲染走 iframe srcdoc(见 features/home)。
export type LandingThemeSummary = {
  id: string
  name: string
  created_at: number
}

export type LandingTheme = LandingThemeSummary & {
  content: string
}

export type LandingThemeListData = {
  themes: LandingThemeSummary[]
  selected: string
}

export type LandingThemeListResponse = {
  success: boolean
  message?: string
  data?: LandingThemeListData
}

export type LandingThemeDetailResponse = {
  success: boolean
  message?: string
  data?: LandingTheme
}

export type SimpleResponse = {
  success: boolean
  message?: string
}
