// @muw-owned
/**
 * 渠道瓷砖的排布口径（**唯一来源**）
 *
 * 排布口径：
 *  - 瓷砖永远只占**一行**，不换行、不平铺
 *  - 每页张数 = min(卡内放得下的张数, 渠道数)
 *  - 本页列数 = 本页实际张数 ⇒ 每页都铺满，不会出现"孤零零一张 + 大片空白"
 *  - 放不下的用模型首行的 ‹ n/N › 翻页
 */

/** 瓷砖的最小可读宽度（px）；窄于此就把每页张数减一 */
export const TILE_MIN_WIDTH = 178
/** 瓷砖间距（px），与组件里的 gap-1.5 一致 */
export const TILE_GAP = 6
/** 每页上限，避免超宽屏一格塞太多 */
export const TILE_MAX_PER_PAGE = 8

/** 给定容器宽度，算一页最多放几张瓷砖 */
export function perPageForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1
  const fit = Math.floor((width + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP))
  return Math.max(1, Math.min(TILE_MAX_PER_PAGE, fit))
}

/** 总页数（至少 1 页，空列表也算 1 页以免出现 0/0） */
export function pageCount(total: number, perPage: number): number {
  const size = Number.isFinite(perPage) ? Math.max(1, Math.floor(perPage)) : 1
  return Math.max(1, Math.ceil(Math.max(0, total) / size))
}

/** 翻页后夹紧页码，避免窗口缩放把页码顶出去 */
export function clampPage(page: number, pages: number): number {
  return Math.max(0, Math.min(Math.floor(page), Math.max(0, pages - 1)))
}
