// @muw-owned
import type { ModelHealthRow } from '../types'

/**
 * 模型健康汇总口径（**唯一来源**）
 *
 * 健康页顶部汇总卡与桌面"健康度"小组件都用这里，避免同一个口径写两遍。
 * 口径与卡片 badge / 非管理员视图对齐：
 *  - client 错误**不进分母**（是调用方的问题，不算渠道不健康）
 *  - 审核拦截**计为成功**
 *  - "异常模型" = 该模型任一 (channel, model) 行成功率 < 100%
 *  - "有流量模型" = 该模型任一行的 user_traffic_count > 0
 */
export interface ModelHealthStats {
  channelCount: number
  totalTests: number
  /** 技术口径成功率（0~100），无样本时按 100 处理 */
  successRate: number
  avgResponseTime: number
  unhealthyModelCount: number
  trafficModelCount: number
}

export function summarizeModelHealth(
  rows: ModelHealthRow[]
): ModelHealthStats {
  const channelCount = new Set(rows.map((row) => row.channel_id)).size
  const totalTests = rows.reduce((sum, row) => sum + row.test_count, 0)
  const totalSuccess = rows.reduce((sum, row) => sum + row.success_count, 0)
  const totalClientErrors = rows.reduce(
    (sum, row) => sum + (row.client_error_count ?? 0),
    0
  )
  const totalModeration = rows.reduce(
    (sum, row) => sum + (row.moderation_count ?? 0),
    0
  )
  const denom = totalTests - totalClientErrors
  const successRate =
    denom > 0 ? ((totalSuccess + totalModeration) / denom) * 100 : 100

  const weightedLatency = rows.reduce(
    (sum, row) => sum + row.avg_response_time * row.test_count,
    0
  )
  const avgResponseTime = totalTests > 0 ? weightedLatency / totalTests : 0

  const byModel = new Map<string, ModelHealthRow[]>()
  for (const row of rows) {
    const list = byModel.get(row.model_name)
    if (list) list.push(row)
    else byModel.set(row.model_name, [row])
  }
  const groups = [...byModel.values()]
  const unhealthyModelCount = groups.filter((group) =>
    group.some((row) => row.success_rate < 100)
  ).length
  const trafficModelCount = groups.filter((group) =>
    group.some((row) => (row.user_traffic_count ?? 0) > 0)
  ).length

  return {
    channelCount,
    totalTests,
    successRate,
    avgResponseTime,
    unhealthyModelCount,
    trafficModelCount,
  }
}
