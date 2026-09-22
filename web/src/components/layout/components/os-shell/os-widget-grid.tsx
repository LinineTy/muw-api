// @muw-owned
import type { CSSProperties, ReactNode } from 'react'

/**
 * OS 桌面 · 右侧小组件区（分区里的"组件区"）
 *
 * 桌面是**分区**布局：左区图标网格、右区小组件。两区共用同一套度量，
 * 所以组件卡和图标是严格对齐的 ——
 *   列 7rem、行 6.25rem、列缝 0.25rem（对齐图标网格的 gap-x-1）、行缝 0.5rem（gap-y-2）
 * 图标网格见 os-desktop-placeholder.tsx，组件尺寸档见 os-widget.tsx。
 *
 * 右区固定 3 列（= 21.5rem，正好等于 max 档 3x2/3x3 的宽度），窄屏整块隐藏 ——
 * 与"磁贴优先"的既有约定一致：放不下时先让出组件区。
 */
export const WIDGET_COLUMNS = 3
export const WIDGET_COL_REM = 7
export const WIDGET_ROW_REM = 6.25
export const WIDGET_GAP_X_REM = 0.25
export const WIDGET_GAP_Y_REM = 0.5

/** 右区总宽（rem）：3 列 + 2 条列缝 */
export const WIDGET_GRID_WIDTH_REM =
  WIDGET_COLUMNS * WIDGET_COL_REM + (WIDGET_COLUMNS - 1) * WIDGET_GAP_X_REM

export const WIDGET_GRID_STYLE: CSSProperties = {
  gridTemplateColumns: `repeat(${WIDGET_COLUMNS}, ${WIDGET_COL_REM}rem)`,
  gridAutoRows: `${WIDGET_ROW_REM}rem`,
  columnGap: `${WIDGET_GAP_X_REM}rem`,
  rowGap: `${WIDGET_GAP_Y_REM}rem`,
  // 行优先：组件按写入顺序自上而下摆，跨列靠 span（1x1 会和相邻的 1x1 并排）
  gridAutoFlow: 'row',
}

export function OsWidgetGrid({ children }: { children: ReactNode }) {
  return (
    <div
      // overflow-x 必须是 hidden：只写 overflow-y-auto 时 CSS 会把 overflow-x 也算成 auto，
      // 收起态的公告卡 translate-x-3 溢出 12px → 底部冒一条横向滚动条（2026-09-12抓的）
      className='hidden min-h-0 shrink-0 self-start overflow-x-hidden overflow-y-auto xl:grid'
      style={{ ...WIDGET_GRID_STYLE, contentVisibility: 'auto' }}
    >
      {children}
    </div>
  )
}
