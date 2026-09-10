// @muw-owned
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
