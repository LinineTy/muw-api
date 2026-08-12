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

// 主题可成套覆盖四页:营销页(home)/About/用户协议/隐私政策。
export type LandingThemeSummary = {
  id: string
  name: string
  created_at: number
  /** 非空页面的 slug:home/about/user_agreement/privacy_policy */
  pages: string[]
  /** 缩略图 data URI(来自 zip 内 preview 图) */
  preview?: string
  /** 版本描述(来自 zip 内 version.txt),卡片右下角展示 */
  version?: string
}

export type LandingTheme = LandingThemeSummary & {
  content: string
  about?: string
  user_agreement?: string
  privacy_policy?: string
}

// 手动预设:四个页面的原文(URL/HTML/Markdown)
export type LandingManual = {
  home: string
  about: string
  user_agreement: string
  privacy_policy: string
}

export type LandingThemeListData = {
  themes: LandingThemeSummary[]
  selected: string
  manual: LandingManual
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
