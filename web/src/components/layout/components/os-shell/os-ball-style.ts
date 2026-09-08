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
