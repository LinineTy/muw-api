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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useTopupInfo } from '@/features/wallet/hooks/use-topup-info'
import type { PaymentMethod } from '@/features/wallet/types'

export interface PaymentMethodFilterOption {
  label: string
  value: string
}

/**
 * 订单中心支付方式相关的配置数据：管理员配置的 PayMethods 及其派生的筛选选项。
 * 两者同源（充值页同一数据源 /api/user/topup/info），避免硬编码的支付宝/微信在
 * 管理员移除后仍残留：
 * - payMethods：原始配置，供订单列 getPaymentMethodName 解析显示名（type → 配置的 name）。
 * - options：筛选下拉选项，value 即 PayMethods 的 type（与订单表 payment_method 一致），
 *   label 用配置的 name，未配置 name 时回退 type。
 * includeBalance=true 时追加固定的「余额」项（订阅订单等存在 balance 支付方式）。
 */
export function usePaymentMethodOptions(includeBalance: boolean): {
  payMethods: PaymentMethod[]
  options: PaymentMethodFilterOption[]
} {
  const { t } = useTranslation()
  const { topupInfo } = useTopupInfo()

  const payMethods = useMemo(() => topupInfo?.pay_methods ?? [], [topupInfo])

  // 注意：options 不能 useMemo。DataTableFacetedFilter 是 React.memo 浅比较 props，
  // 勾选后 columnFilters 更新触发重渲染时，若 options 引用不变，memo 判定 props 未变
  // 就不重渲染、读不到最新 filterValue → 选中态不刷新（跟 type/status 内联数组一个道理，
  // 必须每次渲染新建引用）。payMethods 仍 memo 化供列显示名解析使用。
  const options: PaymentMethodFilterOption[] = [
    { label: t('All Payment Methods'), value: 'all' },
  ]
  const seen = new Set<string>(['all'])
  for (const method of payMethods) {
    if (method.type && !seen.has(method.type)) {
      options.push({ label: method.name || method.type, value: method.type })
      seen.add(method.type)
    }
  }
  if (includeBalance && !seen.has('balance')) {
    options.push({ label: t('Balance'), value: 'balance' })
  }

  return { payMethods, options }
}
