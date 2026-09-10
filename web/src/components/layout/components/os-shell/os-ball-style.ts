// @muw-owned
/**
 * OS 桌面壳 · Dock 球体共享样式。
 * 从 os-dock 抽出:磁贴开始面板(nav-tiles)与 Dock 球共用同一配方,
 * 独立成模块避免 os-dock ↔ nav-tiles 循环依赖。
 */
export const FAB_BALL =
  // 纯图标球:无 border 无自带底色(深色下圈套圈很脏),hover 微亮,
  // 容器感交给 Dock 胶囊;弹层打开时圆→圆角方(data-state)
  'text-primary flex size-10 items-center justify-center' +
  ' transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]' +
  // 弹层打开期间锁缩放:hover 进出/点击若带动按钮尺寸,弹层锚点会跟着位移
  ' hover:bg-accent not-data-[state=open]:hover:scale-[1.08]' +
  ' not-data-[state=open]:active:scale-95 rounded-full data-[state=open]:rounded-lg'

/**
 * 左细条里的小一号球体(32px)。
 * 左条是"细"的次要区,尺寸必须和底部 Dock(40px)拉开层级,
 * 否则两条并排会被读成"两个 Dock"。
 */
export const FAB_BALL_SM =
  'text-muted-foreground hover:text-foreground flex size-8 items-center justify-center' +
  ' transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]' +
  ' hover:bg-accent not-data-[state=open]:hover:scale-[1.08]' +
  ' not-data-[state=open]:active:scale-95 rounded-full data-[state=open]:rounded-lg'

/** 左细条图标尺寸(与 32px 球体配套) */
export const FAB_ICON_SM = 'size-4'

/**
 * 左侧细条占位宽度(条宽 48px + 贴边 4px,再留呼吸)。
 * 最大化窗口要按这个值让出左/右边,否则细条图标会浮在窗口正文上。
 */
export const OS_RAIL_GUTTER = '4.5rem'

/**
 * 底部 Dock 占位高度(dock 距底 12px + 胶囊约 52px,再留 4px 呼吸)。
 * 最大化窗口要按这个值让出底部,否则窗口底边会被 Dock 压住;
 * 开始磁贴面板的 `bottom-[4.25rem]` 同源,改 Dock 高度时一起调。
 */
export const OS_DOCK_GUTTER = '4.25rem'
