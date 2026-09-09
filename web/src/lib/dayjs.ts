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
import dayjs from 'dayjs'
import 'dayjs/locale/fr'
import 'dayjs/locale/ja'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/ru'
import 'dayjs/locale/vi'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'

dayjs.extend(relativeTime)

/**
 * 界面语言代码(i18n 的 zhCN/zhTW)→ dayjs locale。
 * 不做映射时 fromNow() 等相对时间恒为英文("a few seconds ago"),中文界面下露英文。
 */
const DAYJS_LOCALES: Record<string, string> = {
  zhCN: 'zh-cn',
  zhTW: 'zh-tw',
  en: 'en',
  fr: 'fr',
  ru: 'ru',
  ja: 'ja',
  vi: 'vi',
}

/** 由 i18n 初始化与 languageChanged 事件驱动(见 src/i18n/config.ts)。 */
export function syncDayjsLocale(language: string): void {
  dayjs.locale(DAYJS_LOCALES[language] ?? 'en')
}

export default dayjs
