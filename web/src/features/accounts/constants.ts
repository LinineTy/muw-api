// @muw-owned
import { CODING_PLAN_PROVIDER_DISABLED } from '@/features/channels/constants'

/**
 * 编码套餐余量的自动刷新间隔。**与后端自动启停任务的轮询节奏对齐**
 * （`service/coding_plan_auto_control_task.go` 的 codingPlanAutoControlTickInterval = 30s）：
 * 余量端点是一账户一请求的轻量 GET，既然后端每分钟查两次做启停决策，界面照同一个
 * 节奏刷新才不会出现「监控已经动手了、页面还显示旧余量」的错位。
 */
export const QUOTA_REFRESH_MS = 30 * 1000

/**
 * 「自动刷新」开关的本地持久化键。默认开启；关掉后只有手动刷新才更新余量。
 * 键名沿用旧余量页的 `coding-plan-auto-refresh`，两个页面共享同一开关状态。
 */
export const QUOTA_AUTO_REFRESH_STORAGE_KEY = 'coding-plan-auto-refresh'

/** 读取自动刷新开关（默认开）。localStorage 不可用时按开启处理。 */
export function readQuotaAutoRefresh(): boolean {
  try {
    return localStorage.getItem(QUOTA_AUTO_REFRESH_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

/** 写入自动刷新开关。 */
export function writeQuotaAutoRefresh(enabled: boolean): void {
  try {
    localStorage.setItem(QUOTA_AUTO_REFRESH_STORAGE_KEY, String(enabled))
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可（仅影响持久化）。
  }
}

/**
 * 账户是否开启了编码套餐余量监控。
 *
 * ⚠️ 后端用**字面量 `"none"`** 表示「显式关闭监控」（`service.CodingPlanProviderDisabled`），
 * 抽屉保存时也会把关闭状态写成 `"none"`。所以**不能用真值判断**：
 * `Boolean('none') === true`，会把关闭的账户误判成开启 —— 卡片照样渲染「编码套餐余量」块，
 * 还会真去发余量查询，后端回 `coding plan monitoring is disabled for this account`，
 * 界面就成了「查询失败」+ 英文报错 toast（2026-09-11反馈）。
 *
 * 与抽屉表单（account-mutate-drawer.tsx）里的判定保持同一口径：空串与 `"none"` 都算关闭。
 */
export function isCodingPlanMonitored(provider?: string | null): boolean {
  const value = (provider ?? '').trim()
  return value !== '' && value !== CODING_PLAN_PROVIDER_DISABLED
}
