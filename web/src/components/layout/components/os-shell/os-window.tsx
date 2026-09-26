import {
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
  Minus,
  X,
} from 'lucide-react'
// @muw-owned
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDirection } from '@/context/direction-provider'
import { cn } from '@/lib/utils'
import {
  useOsWindowsStore,
  type OsWindowState,
} from '@/stores/os-windows-store'

import { OS_DOCK_GUTTER, OS_RAIL_GUTTER } from './os-ball-style'
import { navigateOsWindowHistory } from './os-window-policy'

/** 拖拽/缩放下限(px) */
const MIN_W = 480
const MIN_H = 320

type DragState =
  | { mode: 'move'; dx: number; dy: number }
  | { mode: 'resize'; sx: number; sy: number; w: number; h: number }
  | null

/**
 * OS 受控窗口(多窗口版):
 * - macOS 三色点全语义:红=关闭(销毁) 黄=最小化(藏到Dock,iframe保活) 绿=最大化
 * - 标题栏拖动移动,右下把手缩放;非激活窗口点击任意处置顶
 * - 内容=同源 iframe:保活完美(切窗/最小化状态全保留),关闭即销毁
 * - iframe 内 AuthenticatedLayout 检测 self!==top 退化为纯内容模式(无壳)
 * - 最小化窗口 display:none 常驻 DOM,保 iframe 会话
 */
export function OsWindowFrame({
  win,
  active,
  icon: TitleIcon,
}: {
  win: OsWindowState
  active: boolean
  icon?: React.ElementType
}) {
  const drag = useRef<DragState>(null)
  // 拖动/缩放中禁几何过渡(否则指针追不上),最大化/恢复切换时才有平滑动画
  const [interacting, setInteracting] = useState(false)
  // 窗口圆角来自主题 token(--radius-2xl = var(--radius) × 1.8,随预设 0.3~1.25rem
  // 变化),右下缩放弧必须与它同心,否则切主题时弧线与窗口圆角错位。读实测计算值
  // 而非解析 CSS 变量:自定义圆角轴会二次覆盖 token,计算值才是最终生效的那个。
  const visualRef = useRef<HTMLDivElement | null>(null)
  const [cornerRadius, setCornerRadius] = useState(36)
  useEffect(() => {
    const el = visualRef.current
    if (!el) return
    const read = () => {
      const radius = Number.parseFloat(
        getComputedStyle(el).borderBottomRightRadius
      )
      // 最大化(rounded-none)/最小化时读不到有效圆角,保留上一次的值
      if (Number.isFinite(radius) && radius > 0) setCornerRadius(radius)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-theme-preset', 'data-theme-radius'],
    })
    return () => observer.disconnect()
  }, [win.maximized])
  const { t } = useTranslation()
  const { dir } = useDirection()
  const rtl = dir === 'rtl'
  const {
    closeWindow,
    requestCloseWindow,
    minimizeWindow,
    requestMinimizeWindow,
    activateWindow,
    toggleMaximize,
    moveWindow,
    resizeWindow,
  } = useOsWindowsStore()

  // 两段式关闭:closing 置位播退出动画,220ms 后真正移除(兜底定时器防动画事件丢失)
  useEffect(() => {
    if (!win.closing) return
    const t = setTimeout(() => closeWindow(win.id), 240)
    return () => clearTimeout(t)
  }, [win.closing, win.id, closeWindow])

  // 两段式最小化:minimizing 置位播缩退动画,200ms 后真正藏入 Dock
  useEffect(() => {
    if (!win.minimizing) return
    const t = setTimeout(() => minimizeWindow(win.id), 210)
    return () => clearTimeout(t)
  }, [win.minimizing, win.id, minimizeWindow])

  const onTitleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (win.maximized) return
    if ((e.target as HTMLElement).closest('button')) return
    setInteracting(true)
    drag.current = {
      mode: 'move',
      dx: e.clientX - win.x,
      dy: e.clientY - win.y,
    }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 个别环境对合成/异常 pointerId 会 throw;drag 状态已就绪,仅失去强制捕获 */
    }
  }
  const onTitleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d?.mode !== 'move') return
    const x = Math.min(
      Math.max(e.clientX - d.dx, -40),
      window.innerWidth - MIN_W + 40
    )
    const y = Math.min(Math.max(e.clientY - d.dy, 0), window.innerHeight - 80)
    moveWindow(win.id, x, y)
  }
  const onTitleUp = () => {
    drag.current = null
    setInteracting(false)
  }

  const onResizeDown = (e: React.PointerEvent<Element>) => {
    if (win.maximized) return
    setInteracting(true)
    drag.current = {
      mode: 'resize',
      sx: e.clientX,
      sy: e.clientY,
      w: win.w ?? MIN_W,
      h: win.h ?? MIN_H,
    }
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* 同 onTitleDown */
    }
  }
  const onResizeMove = (e: React.PointerEvent<Element>) => {
    const d = drag.current
    if (d?.mode !== 'resize' || d.w == null || d.h == null) return
    const w = Math.min(
      Math.max(d.w + (e.clientX - d.sx), MIN_W),
      window.innerWidth - 120
    )
    const h = Math.min(
      Math.max(d.h + (e.clientY - d.sy), MIN_H),
      window.innerHeight - 140
    )
    resizeWindow(win.id, w, h)
  }
  const onResizeUp = () => {
    drag.current = null
    setInteracting(false)
  }

  const style: React.CSSProperties = win.maximized
    ? {
        left: rtl ? 0 : OS_RAIL_GUTTER,
        top: 0,
        width: `calc(100% - ${OS_RAIL_GUTTER})`,
        // 让开底部 Dock:否则最大化窗口底边被浮在上层的 Dock 压住
        height: `calc(100% - ${OS_DOCK_GUTTER})`,
        zIndex: win.zIndex,
      }
    : {
        left: win.x,
        top: win.y,
        width: win.w ?? undefined,
        height: win.h ?? undefined,
        zIndex: win.zIndex,
      }

  // 最小化保活:DOM 结构保持不变,仅 display:none——若走条件渲染换结构,
  // React 会卸载重建 iframe,导致每次最小化/恢复整页重载(请求风暴 429)
  if (win.minimized) style.display = 'none'

  // 缩放弧几何:与窗口圆角同心,外缘只在窗体边缘外 CORNER_GAP px(贴边)。
  // ARC_PAD 是弧线中心到把手容器边缘的留白(容纳圆头线帽)。
  const ARC_PAD = 6
  const CORNER_GAP = 2
  const arcRadius = cornerRadius + CORNER_GAP
  const arcSize = arcRadius + ARC_PAD * 2
  // 起止角与旧实现一致(15°~75°),只按半径缩放:弧不贴到窗口边的延长线上,
  // 看起来像"包住角"的一道弧而不是四分之一圆框
  const arcPoint = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    return [
      ARC_PAD + arcRadius * Math.cos(rad),
      ARC_PAD + arcRadius * Math.sin(rad),
    ] as const
  }
  const [arcX0, arcY0] = arcPoint(75)
  const [arcX1, arcY1] = arcPoint(15)
  const arcPath = `M ${arcX0} ${arcY0} A ${arcRadius} ${arcRadius} 0 0 0 ${arcX1} ${arcY1}`

  return (
    // 外层=定位/动画层:无视觉无裁剪,缩放弧线把手悬浮在这一层的窗口圆角外
    <div
      data-os-window={win.id}
      style={style}
      onPointerDown={() => !active && activateWindow(win.id)}
      className={cn(
        'absolute flex flex-col',
        // 几何变化过渡:最大化/恢复平滑展开;拖动缩放中禁用
        !interacting &&
          'transition-[left,top,width,height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        // 开/关窗动画:入场默认播(会话恢复的窗除外),关闭播退出,
        // 最小化播缩退,从 Dock 恢复播浮入
        !win.minimized && !win.closing && !win.restored && 'os-window-restore',
        win.minimizing && 'os-window-minimize',
        win.closing && 'os-window-exit'
      )}
    >
      {/* 内层=视觉裁剪层:圆角/玻璃材质/边框/影子/描边都在这层,
          overflow-hidden 负责把 iframe 内容裁进圆角——缩放把手必须留在
          这层之外,否则贴角部分会被圆角曲线物理裁掉(实测 36px 圆角) */}
      <div
        ref={visualRef}
        className={cn(
          // 亮暗统一琉璃配方:暗色 --card 自带低透明度,壁纸可透出
          'border-border/60 relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-[8px] saturate-150',
          // 最大化贴边:去圆角;激活窗加淡描边置前强调
          win.maximized && 'rounded-none',
          active && 'border-primary/40 ring-primary/25 ring-1',
          active
            ? 'shadow-[0_24px_80px_rgba(0,0,0,0.22)]'
            : 'shadow-[0_12px_40px_rgba(0,0,0,0.12)] opacity-95'
        )}
      >
        {/* 标题栏:三色点 + 居中页名,可拖动 */}
        <div
          onPointerDown={onTitleDown}
          onPointerMove={onTitleMove}
          onPointerUp={onTitleUp}
          onPointerCancel={onTitleUp}
          className={cn(
            'border-border/40 flex h-10 shrink-0 items-center gap-2 border-b px-3',
            !win.maximized && 'cursor-grab active:cursor-grabbing'
          )}
        >
          {/* 左侧:[后退,前进,最大化];右侧=[最小化,关闭]。hover 只变亮不做彩色底。
              后退/前进作用于本窗口自己的历史(窗口里换了页要能退回去) */}
          <div className='flex items-center gap-0.5'>
            <button
              type='button'
              aria-label={t('Back')}
              title={t('Back')}
              disabled={!win.canBack}
              onClick={() => navigateOsWindowHistory(win.id, -1)}
              className='text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-accent flex size-6 items-center justify-center rounded-md transition-colors disabled:opacity-35'
            >
              <ArrowLeft className='size-3' aria-hidden='true' />
            </button>
            <button
              type='button'
              aria-label={t('Forward')}
              title={t('Forward')}
              disabled={!win.canForward}
              onClick={() => navigateOsWindowHistory(win.id, 1)}
              className='text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-accent flex size-6 items-center justify-center rounded-md transition-colors disabled:opacity-35'
            >
              <ArrowRight className='size-3' aria-hidden='true' />
            </button>
            <button
              type='button'
              aria-label={t('Maximize window')}
              title={t('Maximize window')}
              onClick={() => toggleMaximize(win.id)}
              className='text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 items-center justify-center rounded-md transition-colors'
            >
              {win.maximized ? (
                <Minimize2 className='size-3' aria-hidden='true' />
              ) : (
                <Maximize2 className='size-3' aria-hidden='true' />
              )}
            </button>
          </div>
          <div className='text-muted-foreground pointer-events-none flex min-w-0 flex-1 items-center justify-center gap-1.5 text-sm'>
            {TitleIcon ? (
              <TitleIcon className='size-4 shrink-0' aria-hidden='true' />
            ) : null}
            <span className='truncate'>{win.title}</span>
          </div>
          <div className='flex items-center gap-0.5'>
            <button
              type='button'
              aria-label={t('Minimize window')}
              title={t('Minimize window')}
              onClick={() => requestMinimizeWindow(win.id)}
              className='text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 items-center justify-center rounded-md transition-colors'
            >
              <Minus className='size-3' aria-hidden='true' />
            </button>
            <button
              type='button'
              aria-label={t('Close window')}
              title={t('Close window')}
              onClick={() => requestCloseWindow(win.id)}
              className='text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 items-center justify-center rounded-md transition-colors'
            >
              <X className='size-3' aria-hidden='true' />
            </button>
          </div>
        </div>

        {/* 内容:同源 iframe(self!==top 时子应用渲染纯内容)
          lazy=恢复后未唤起的窗,挂 about:blank 占位,唤起才真加载;
          load 完成前保持透明,内容就绪后淡入(消除窗口展开后白屏闪现) */}
        <IframePane
          id={win.id}
          url={win.url}
          lazy={win.lazy}
          title={win.title}
        />
      </div>

      {/* 右下角缩放把手:书名号弧线——与窗口圆角(--radius-2xl,随主题变)同心
          平行的外弧,外缘贴住窗体边缘(2px),像包住窗口角的一道弧。热区=透明
          16px 宽弧,可见线 3px 仅展示;pointer-events 只在弧线上,不挡弧线圈内
          的桌面交互。挂在定位层,不被内层 overflow-hidden 裁剪 */}
      {!win.maximized ? (
        <div
          className='group text-muted-foreground/70 group-hover:text-foreground pointer-events-none absolute z-30 transition-colors'
          style={{
            right: -(ARC_PAD + CORNER_GAP),
            bottom: -(ARC_PAD + CORNER_GAP),
            width: arcSize,
            height: arcSize,
          }}
          role='presentation'
        >
          <svg
            viewBox={`0 0 ${arcSize} ${arcSize}`}
            width={arcSize}
            height={arcSize}
            fill='none'
            aria-hidden='true'
          >
            {/* 热区:透明宽弧,负责拖拽交互 */}
            <path
              d={arcPath}
              stroke='transparent'
              strokeWidth={16}
              strokeLinecap='round'
              className='pointer-events-auto cursor-nwse-resize touch-none'
              onPointerDown={onResizeDown}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
            />
            {/* 可见弧线 */}
            <path
              d={arcPath}
              stroke='currentColor'
              strokeWidth={3}
              strokeLinecap='round'
              className='pointer-events-none'
            />
          </svg>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 窗口内容面板:iframe onLoad 前保持透明,就绪后淡入。
 *
 * ⚠️ 地址只认"打开/唤起时"那一次:窗口内的页面自己跳转后,外层记录的 `win.url`
 * 会跟着更新(标题栏与 Dock 要用),**但不能写回 iframe** —— 重新赋值 src 会让整个
 * 窗口重新加载,页面状态全丢,且每次窗内跳转都发一轮请求。
 */
function IframePane({
  id,
  url,
  lazy,
  title,
}: {
  id: string
  url: string
  lazy?: boolean
  title: string
}) {
  const [src, setSrc] = useState(() => (lazy ? 'about:blank' : url))
  const [ready, setReady] = useState(false)
  // 恢复的懒窗被唤起:这一次才把 about:blank 换成真地址(唯一允许的替换)
  useEffect(() => {
    if (lazy) return
    setSrc((prev) => (prev === 'about:blank' ? url : prev))
  }, [lazy, url])
  useEffect(() => {
    setReady(false)
  }, [src])
  return (
    // 窗口化依赖同源登录态/localStorage,不能加 sandbox(规则误伤,行级豁免)
    // 窗口内的 Passkey/WebAuthn 调用按规范需要显式放行这两个特性
    // oxlint-disable-next-line react/iframe-missing-sandbox
    <iframe
      src={src}
      data-os-window-id={id}
      title={title}
      allow='publickey-credentials-create; publickey-credentials-get'
      onLoad={() => setReady(true)}
      className={cn(
        'min-h-0 flex-1 border-0 bg-transparent transition-opacity duration-300',
        ready ? 'opacity-100' : 'opacity-0'
      )}
    />
  )
}
