// @muw-owned
import { useTranslation } from 'react-i18next'

import { useSystemLoad } from '@/features/dashboard/hooks/use-system-load'
import { useDashboardContentVisibility } from '@/features/dashboard/hooks/use-status-data'

import { useOsShellNavigate } from './os-open'
import { OsWidget, WIDGET_CLICKABLE_CLASS } from './os-widget'

/**
 * OS 桌面 · 系统负载小组件（**两个 1x1**，摆在组件区最上面）
 *
 * maintainer 2026-09-12 定的形态："2 个 1x1，最上面"。1x1 只有 112×100px，
 * 一个格子塞得下一个"百分比 + 标签 + 细进度条"，所以拆成 CPU / 内存两张。
 *
 * 数据源（2026-09-12 maintainer纠正）：**和概览页同源** —— 公开的 `/api/status` → `system_load`，
 * 走现成的 `useSystemLoad()`（30s 轮询、尊重后台 system_load_enabled 开关）。
 * ⚠️ 早先我误用了 `/api/system-info/instances`（那个是 **RootAuth 仅 root**）：
 * 结果普通用户看不到、非 root 的管理员反而看不到 —— 数据是公开的，就该按公开的取，
 * 不要看它属于哪个页面（"系统信息"页面是管理工作台 ≠ 数据本身是私密的）。
 *
 * 可见性完全交给后台开关：管理员在"系统设置"里关掉负载展示，这里跟着消失，
 * 不做自己的权限判断（普通用户也能看到概览，桌面同理）。
 * 点击 = 打开概览（这数据本来就在概览里）。
 */
function barClass(percent: number) {
  if (percent >= 90) return 'bg-destructive'
  if (percent >= 75) return 'bg-amber-500'
  return 'bg-primary'
}

function MetricWidget(props: {
  label: string
  /** undefined = 该指标还没上报/还没回来 → 显示 — */
  percent: number | undefined
  onOpen: () => void
}) {
  const { label, percent, onOpen } = props
  // 数值还没回来（或该指标没上报）就显示 —，**卡片本身不消失** ——
  // 组件悄悄消失会留下空洞、让人以为坏了（2026-09-12 maintainer抓的就是这个）
  const clamped = percent === undefined ? null : Math.max(0, Math.min(100, percent))

  return (
    <OsWidget size='1x1'>
      <button type='button' onClick={onOpen} className={WIDGET_CLICKABLE_CLASS}>
        <span className='text-muted-foreground text-[0.6875rem] leading-none'>
          {label}
        </span>
        <span className='text-xl leading-none font-semibold tabular-nums'>
          {clamped === null ? '—' : `${Math.round(clamped)}%`}
        </span>
        <span className='bg-muted/70 h-1 w-full overflow-hidden rounded-full'>
          <span
            className={`block h-full rounded-full ${
              clamped === null ? 'bg-muted-foreground/40' : barClass(clamped)
            }`}
            style={{ width: `${clamped ?? 0}%` }}
          />
        </span>
      </button>
    </OsWidget>
  )
}

export function OsDesktopSystemMetrics() {
  const { t } = useTranslation()
  const osNavigate = useOsShellNavigate()
  // 后台"显示系统负载"开关（与概览页同一份判定）
  const { systemLoad: enabled } = useDashboardContentVisibility()
  const { load } = useSystemLoad(enabled)

  // 只有后台关掉了"显示系统负载"才整体不渲染（那是管理员的显式选择，概览页同样处理）
  if (!enabled) return null
  const { cpu_usage: cpu, memory_usage: memory } = load ?? {}

  const open = () => osNavigate('/dashboard')

  return (
    <>
      {/* 两张卡恒定渲染（数值没回来就是 —），保证网格布局稳定、不会忽多忽少 */}
      <MetricWidget label={t('CPU')} percent={cpu} onOpen={open} />
      <MetricWidget label={t('Memory')} percent={memory} onOpen={open} />
    </>
  )
}
