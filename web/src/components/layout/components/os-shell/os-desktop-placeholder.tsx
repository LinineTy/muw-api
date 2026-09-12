import { useDirection } from '@/context/direction-provider'
// @muw-owned
import { cn } from '@/lib/utils'

import { OsDesktopBalance } from './os-desktop-balance'
import { OsDesktopModelHealth } from './os-desktop-model-health'
import { OsDesktopNotices } from './os-desktop-notices'
import { OsDesktopRequests } from './os-desktop-requests'
import { OsDesktopSystemMetrics } from './os-desktop-system-metrics'
import { useOsShellNavigate } from './os-open'
import { useOsNavItems } from './use-os-nav'
import { OsWidgetGrid } from './os-widget-grid'

/**
 * OS 桌面壳 · 空桌面态:
 * 窗口被关闭(红点)后显示全部导航项,形态对齐 QwenPaw 自带桌面——
 * **平铺、不分组**,列优先(先自上而下、再从左到右)一格格排下来。
 * 早先是"按侧栏分组 + 每组标题 + 每组居中",既啰嗦又参差。
 *
 * 左边细条(见 os-side-strip.tsx)已承载品牌,这里不再重复提示文案。
 */
export function OsDesktopPlaceholder() {
  const items = useOsNavItems()
  const osNavigate = useOsShellNavigate()
  const { dir } = useDirection()
  const rtl = dir === 'rtl'

  return (
    <div
      className={cn(
        // 横向分栏:左边磁贴网格,右边时间线公告堆叠卡
        'flex h-full w-full gap-6 py-8',
        // 细条宽 48px 贴边 4px:内容至少让出 56px,再留一点呼吸
        rtl ? 'pr-16 pl-8' : 'pl-16 pr-8'
      )}
    >
      {/* 列优先网格:先自上而下填满一列,再排下一列(桌面图标的排法)。
          行高 auto-fill 必须配**确定高度**才算得出行数,否则只会摊成一行 —— 
          所以这里 min-h-0 flex-1 撑满剩余高度 */}
      <div
        className='grid min-h-0 flex-1 gap-x-1 gap-y-2 overflow-auto'
        style={{
          gridAutoFlow: 'column',
          // 行:按可用高度自动分行(屏越高一列放得越多)
          gridTemplateRows: 'repeat(auto-fill, 6.25rem)',
          // 列:固定列宽 + 从左侧排起,否则隐式列会平分剩余宽度、格子被拉散
          gridAutoColumns: '7rem',
          justifyContent: 'start',
        }}
      >
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.url}
              type='button'
              onClick={() => osNavigate(item.url)}
              title={item.title}
              className='group hover:bg-popover/40 focus-visible:ring-ring/40 flex w-[6.5rem] flex-col items-center gap-2 rounded-xl px-1 py-2 transition-colors outline-none focus-visible:ring-2'
            >
              {/* 方圆形磁贴:圆角约 20%,玻璃底,与 Dock 的圆形球体区分 */}
              <span className='bg-popover/55 border-border/40 group-hover:border-border/70 flex size-14 items-center justify-center rounded-[1.15rem] border backdrop-blur-[6px] transition-transform duration-200 group-hover:scale-[1.04]'>
                {Icon ? <Icon className='size-6' aria-hidden='true' /> : null}
              </span>
              <span className='line-clamp-2 w-full text-center text-xs leading-tight'>
                {item.title}
              </span>
            </button>
          )
        })}
      </div>

      {/* 右侧:小组件区(分区布局)。与左区共用度量 —— 列 7rem / 行 6.25rem /
          列缝 0.25rem / 行缝 0.5rem,所以组件卡与图标严格对齐。
          组件尺寸档见 os-widget.tsx,摆放顺序=组件写入顺序(行优先)。
          放不下(窄屏)时整块隐藏,磁贴优先 */}
      <OsWidgetGrid>
        {/* 顺序 = 摆放顺序（行优先）。maintainer定：系统信息两张 1x1 放最上面。
            第 1 行 = CPU + 内存 + 模型健康；第 2 行 = 余额(2) + 今日请求数；
            第 3-4 行 = 公告(3x2) —— 4 行 × 3 列正好排满，不留空洞 */}
        <OsDesktopSystemMetrics />
        <OsDesktopModelHealth />
        <OsDesktopBalance />
        <OsDesktopRequests />
        <OsDesktopNotices />
      </OsWidgetGrid>
    </div>
  )
}
