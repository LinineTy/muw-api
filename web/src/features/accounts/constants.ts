// @muw-owned
/**
 * 编码套餐余量的查询节奏。与旧渠道余量页保持一致：默认 5 分钟自动刷新一次。
 * 账户页与渠道页共用同一份开关与间隔，避免两处节奏不一致。
 */
export const QUOTA_REFRESH_MS = 5 * 60 * 1000

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
