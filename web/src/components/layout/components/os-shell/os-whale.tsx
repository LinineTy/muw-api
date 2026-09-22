// @muw-owned
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import {
  pickWhaleBubble,
  pickWhaleGifFailBubble,
  type WhaleBubbleContent,
  type WhaleLine,
} from './os-whale-lines'
import { useOsWhaleStore, WHALE_SOUND_FILES } from './os-whale-store'

/**
 * OS 桌面 · 小鲸鱼挂件（右下角常驻的装饰件）
 *
 * 出处：MeteorNOX/DeepSeek-Balance-Whale-Widget（MIT，素材许可见 public/os-whale/）。
 * 2026-09-14：「只要好玩的，数据的不要」—— 于是这个移植版**砍掉了原版全部数据面**：
 * 余额 / 今日已用 / 每轮消耗 / 峰谷定价 / 60s 刷新 / 记账模式，以及依附于拖拽的
 * 四边吸附、左吸附镜像、汉堡菜单。留下的只有手感与嘴：
 *
 * - 鲸鱼娘本体定格右下角（原版就是 `right:0;bottom:0`）
 * - 按住压扁（底部不动）、松手回弹，带按压/松手音效（两套：小黄鸭 / 音效 1，见 os-whale-store.ts）
 * - 点一下张嘴说一句台词（5 秒自动收），有 rua 动图那段
 * - 大小从侧栏「偏好设置」弹窗调（os-preferences-dialog.tsx），存浏览器本地
 *
 * 三条必须照抄原版的地方，别顺手"优化"掉：
 * 1. **像素级命中**（`isWhaleHit`）：把本体 PNG 画进 canvas 取 alpha，只有点到鲸鱼本身
 *    才算数 —— 挂件盒子有近一半是透明的，不做这层过滤会吃掉页面的点击。
 * 2. **命中区域吞掉 pointerdown/pointerup/click**：不然点击会穿透到下面的窗口内容
 *    （原版踩过"误打开文件"）。**但被窗口盖住的那部分必须放行** —— 见下面第 4 条。
 * 3. **压扁作用在 body 上并 `transform-origin:50% 100%`**：底部坐标不动，才像被按下去的玩偶。
 *
 * 第 4 条是本仓加的（原版浮在网页上，没有"窗口"这一层）：
 * 4. **挂件属于「桌面装饰层」，被窗口盖住时不再吞点击**（`whaleIsExposed`）。层级改成
 *    `z-0` 之后窗口会压在鲸鱼上面，而命中判定是 document 级按坐标算的 —— 不补这层
 *    检查，被盖住的地方照样吞掉点击：窗口里的按钮看得见、点不动，还找不到原因。
 */
const WHALE_IMAGE = '/os-whale/whale.png'
const WHALE_GIF = '/os-whale/rua.gif'

/** 气泡设计稿边长（原版 SVG viewBox 宽），所有字号按它等比换算 */
const DESIGN = 1026
/** 命中测试画布边长（= 本体 PNG 边长） */
const HIT_SIZE = 610
/** 气泡停留时长 */
const BUBBLE_MS = 5000
/** 关闭后等淡出走完再卸内容 */
const BUBBLE_FADE_MS = 260
/** 按下姿态：压扁 + 微微变胖（原版 SQUISH） */
const SQUISH = 'scaleY(0.88) scaleX(1.05)'
/** 位移平方阈值：超过即视为拖动，不当点击（原版 CLICK_SQ） */
const CLICK_SQ = 9
/** 气泡描边（深蓝） */
const INK = '#203170'
/** 气泡文字色 */
const TEXT_INK = '#536ba9'

/**
 * 这一点上鲸鱼是不是"露着"的：没有任何窗口/壳控件压在它上面。
 *
 * 为什么需要：挂件的点击是靠 **document 级监听 + 坐标命中**吞掉的，跟"谁在最上层"
 * 没关系 —— 层级降到 `z-0`（桌面装饰层）之后，窗口会盖在鲸鱼上面，如果还按坐标吞，
 * 就会出现"窗口内容看得见、点不动"的幽灵吞点击（窗口里是同源 iframe，父层 capture
 * 照样拦得住）。判据看**该点最上层的元素属于哪一层**：
 * - 桌面层（`data-os-desktop`）或挂件自己（`data-os-whale`，气泡展开时才有货）⇒ 露着
 * - body/html ⇒ 那里没别的东西，也算露着
 * - 其余（窗口 iframe / 弹窗遮罩 / Dock / 侧栏球…）⇒ 被盖住，放行
 *   ※ 全屏的"点外部关闭"层也算：Base UI 打开菜单时会给主内容 inert 并铺一层
 *     `data-base-ui-inert` 的全屏层，这一点上最上层就不是桌面了 —— 放行的语义正好：
 *     菜单开着时点鲸鱼，这一下该去关菜单（以前鲸鱼会把这一下吞掉、菜单卡着不关）。
 *
 * 注意挂件盒子是 `pointer-events:none`，所以 elementFromPoint **永远不会**返回盒子本身；
 * 只有气泡展开时的 `pointer-events-auto` 子层会被返回，靠 `data-os-whale` 认领。
 */
function whaleIsExposed(point: { clientX: number; clientY: number }) {
  // jsdom 没有 layout（elementFromPoint 不可用/不可靠）⇒ 拿不到就按"露着"处理，
  // 保持单测里用坐标直驱交互的老口径；真实浏览器里这层检查始终生效。
  if (typeof document.elementFromPoint !== 'function') return true
  let top: Element | null = null
  try {
    top = document.elementFromPoint(point.clientX, point.clientY)
  } catch {
    return true
  }
  if (!top) return true
  if (top === document.body || top === document.documentElement) return true
  return Boolean(top.closest('[data-os-desktop],[data-os-whale]'))
}

/** 一行台词的排版：字号跟着 `--whale-u` 走，气泡整体放大缩小时文字同步 */
function lineStyle(line: WhaleLine): React.CSSProperties {
  const big = line.s === 'B'
  // 长台词（wrap）另有一档：原版把 wrap 挂在 A 档的 66u 上，可那边的长句是
  // 「你目录里的dsh是什么…」这种；本仓的台词更长（中文 11~14 字），66u 会挤成两行、
  // 还在气泡下缘贴边。降到 56u + 放宽到 680u，绝大多数句子一行放得下。
  if (line.w) {
    return {
      fontSize: 'calc(var(--whale-u) * 56)',
      fontWeight: 600,
      letterSpacing: '0.06em',
      lineHeight: 1.25,
      whiteSpace: 'normal',
      maxWidth: 'calc(var(--whale-u) * 680)',
    }
  }
  return {
    fontSize: `calc(var(--whale-u) * ${big ? 128 : 66})`,
    fontWeight: big ? 800 : 600,
    letterSpacing: big ? undefined : '0.06em',
    lineHeight: big ? 1.05 : 1.15,
    whiteSpace: 'nowrap',
  }
}

export function OsWhale() {
  const visible = useOsWhaleStore((state) => state.visible)
  const scale = useOsWhaleStore((state) => state.scale)
  const volume = useOsWhaleStore((state) => state.volume)
  const soundSet = useOsWhaleStore((state) => state.soundSet)

  const imageRef = useRef<HTMLImageElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const hitCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const hitReadyRef = useRef(false)

  // 按压 / 音效状态（放 ref：document 级监听里读最新值，不重挂监听）
  const pressingRef = useRef(false)
  const pressEndedRef = useRef(false)
  const releasePlayedRef = useRef(false)
  const releaseTimerRef = useRef<number | null>(null)
  const pressStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(
    null
  )
  const pressAudioRef = useRef<HTMLAudioElement | null>(null)
  const releaseAudioRef = useRef<HTMLAudioElement | null>(null)

  const [pressed, setPressed] = useState(false)
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const [content, setContent] = useState<WhaleBubbleContent | null>(null)
  const bubbleTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  /** 尺寸：随视口自适应 + 用户倍数（原版公式，1 倍 ≈ 视口短边的 28%，上限 625px） */
  const base = `clamp(122px, calc(min(250px, min(100vw, 100vh) * 0.28) * ${scale}), 625px)`

  // —— 音效 ——
  // 依赖 soundSet：切音效集时重建 Audio 元素（旧的 src 置空释放），
  // 顺带把按压/松手的状态位复位，免得切集瞬间的 onended 回调触发上一集的松手音。
  useEffect(() => {
    const files = WHALE_SOUND_FILES[soundSet]
    const press = new Audio(files.press)
    press.preload = 'auto'
    const release = new Audio(files.release)
    release.preload = 'auto'
    pressAudioRef.current = press
    releaseAudioRef.current = release
    pressingRef.current = false
    pressEndedRef.current = false
    releasePlayedRef.current = false
    return () => {
      if (releaseTimerRef.current) window.clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
      press.onended = null
      // 断开引用，防挂件卸载后音频元素还挂着
      press.src = ''
      release.src = ''
      pressAudioRef.current = null
      releaseAudioRef.current = null
    }
  }, [soundSet])

  useEffect(() => {
    if (pressAudioRef.current) pressAudioRef.current.volume = volume
    if (releaseAudioRef.current) releaseAudioRef.current.volume = volume
  }, [volume])

  /**
   * 松手音效。原版逻辑：如果 Ya1（按压音）已经放完（长按），松手立刻补 Ya2；
   * 否则在 Ya1 结束前 100ms 起 Ya2，听起来才是一个连贯的"叫一声"。
   */
  const playRelease = useCallback(() => {
    const release = releaseAudioRef.current
    if (!release || releasePlayedRef.current) return
    if (!useOsWhaleStore.getState().soundOn) return
    releasePlayedRef.current = true
    try {
      release.currentTime = 0
      void release.play().catch(() => {})
    } catch {
      // 素材缺失/浏览器拦截：静默降级，不打断交互
    }
  }, [])

  const playPress = useCallback(() => {
    const press = pressAudioRef.current
    const release = releaseAudioRef.current
    if (!press || !release) return
    if (!useOsWhaleStore.getState().soundOn) return
    try {
      if (releaseTimerRef.current) {
        window.clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      release.pause()
      release.currentTime = 0
      pressEndedRef.current = false
      releasePlayedRef.current = false
      press.onended = () => {
        pressEndedRef.current = true
        // 时长兜底：Ya1 放完时若已松手，补 Ya2（拿不到 duration 时走这条）
        if (!pressingRef.current && !releasePlayedRef.current) playRelease()
      }
      press.currentTime = 0
      void press.play().catch(() => {})
    } catch {
      // 同上：静默降级
    }
  }, [playRelease])

  const pressUp = useCallback(() => {
    setPressed(false)
    pressingRef.current = false
    if (pressEndedRef.current) {
      playRelease()
      return
    }
    const press = pressAudioRef.current
    let remainMs: number | null = null
    try {
      const dur = press?.duration
      if (press && typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
        remainMs = (dur - press.currentTime) * 1000
      }
    } catch {
      remainMs = null
    }
    if (remainMs !== null) {
      releaseTimerRef.current = window.setTimeout(
        () => {
          releaseTimerRef.current = null
          playRelease()
        },
        Math.max(0, remainMs - 100)
      )
    }
    // 拿不到时长 → 交给 press.onended 兜底
  }, [playRelease])

  // —— 像素级命中：把本体 PNG 画进 canvas，按 alpha 判断有没有点到鲸鱼 ——
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = HIT_SIZE
    canvas.height = HIT_SIZE
    hitCanvasRef.current = canvas
    const probe = new Image()
    probe.onload = () => {
      try {
        // 拉伸到 610×610，与 isWhaleHit 的坐标映射对齐
        canvas.getContext('2d')?.drawImage(probe, 0, 0, HIT_SIZE, HIT_SIZE)
        hitReadyRef.current = true
      } catch {
        hitReadyRef.current = false
      }
    }
    probe.src = WHALE_IMAGE
    return () => {
      hitReadyRef.current = false
      hitCanvasRef.current = null
    }
  }, [])

  const isWhaleHit = useCallback(
    (point: { clientX: number; clientY: number }) => {
      // ① 先看层级：被窗口（或更上层的壳控件）盖住 ⇒ 这一点不属于鲸鱼，放行
      if (!whaleIsExposed(point)) return false

      const canvas = hitCanvasRef.current
      // ② 画布没就绪时按"命中"处理（原版同款兜底）：宁可多吃一次点击，也别让挂件没反应
      if (!canvas || !hitReadyRef.current) return true
      try {
        const rect = imageRef.current?.getBoundingClientRect()
        if (!rect || rect.width <= 0 || rect.height <= 0) return false
        const lx = ((point.clientX - rect.left) / rect.width) * HIT_SIZE
        const ly = ((point.clientY - rect.top) / rect.height) * HIT_SIZE
        if (lx < 0 || ly < 0 || lx >= HIT_SIZE || ly >= HIT_SIZE) return false
        const ctx = canvas.getContext('2d')
        if (!ctx) return true
        return (
          ctx.getImageData(Math.floor(lx), Math.floor(ly), 1, 1).data[3] > 10
        )
      } catch {
        return true
      }
    },
    []
  )

  // —— 气泡开关 ——
  function clearBubbleTimer() {
    if (bubbleTimerRef.current) {
      window.clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = null
    }
  }

  const closeBubble = useCallback(() => {
    clearBubbleTimer()
    openRef.current = false
    setOpen(false)
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    // 淡出走完再卸内容：关掉瞬间不能清空，否则尾巴/文字会闪一下
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setContent(null)
    }, BUBBLE_FADE_MS)
  }, [])

  const openBubble = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setContent(pickWhaleBubble())
    openRef.current = true
    setOpen(true)
    clearBubbleTimer()
    bubbleTimerRef.current = window.setTimeout(closeBubble, BUBBLE_MS)
  }, [closeBubble])

  const toggleBubble = useCallback(() => {
    if (openRef.current) closeBubble()
    else openBubble()
  }, [closeBubble, openBubble])

  // —— 指针交互（document 级 + 命中过滤）——
  useEffect(() => {
    // 挂件关掉时不挂监听：省掉每一下点击的命中测试，也保证右下角完全"不存在"
    if (!visible) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      if (!isWhaleHit(event)) return
      // 命中鲸鱼本体：吃掉这次事件，别让它穿透到下面窗口里的按钮/文件行
      event.preventDefault()
      event.stopPropagation()
      pressStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        moved: false,
      }
      pressingRef.current = true
      setPressed(true)
      playPress()
    }
    const onPointerMove = (event: PointerEvent) => {
      const start = pressStartRef.current
      if (!start) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (dx * dx + dy * dy >= CLICK_SQ) start.moved = true
    }
    const onPointerUp = (event: PointerEvent) => {
      const start = pressStartRef.current
      if (!start) return
      pressStartRef.current = null
      if (isWhaleHit(event)) {
        event.preventDefault()
        event.stopPropagation()
      }
      pressUp()
      if (!start.moved) toggleBubble()
    }
    const onPointerCancel = () => {
      pressStartRef.current = null
      pressUp()
    }
    // click 在 pointerup 之后派发：只在命中区域拦，透明区照旧穿透
    const onClickCapture = (event: MouseEvent) => {
      if (!isWhaleHit(event)) return
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [visible, isWhaleHit, playPress, pressUp, toggleBubble])

  // 关掉挂件时顺手收干净：气泡收掉、挂起的松手音计时器清掉、正在播的音频停掉 ——
  // 不然隐藏期间计时器还在跑，重新打开会先冒出一个"半截气泡"或补一声幽灵音。
  useEffect(() => {
    if (visible) return
    closeBubble()
    if (releaseTimerRef.current) {
      window.clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    pressAudioRef.current?.pause()
    releaseAudioRef.current?.pause()
  }, [visible, closeBubble])

  // 卸载时清计时器
  useEffect(
    () => () => {
      clearBubbleTimer()
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
      if (releaseTimerRef.current) window.clearTimeout(releaseTimerRef.current)
    },
    []
  )

  // 整个挂件的显隐开关（2026-09-14：「万一不想看了还能关掉」）——
  // 关掉就整块不渲染：盒子、像素命中、气泡、音效全都不存在，右下角点击照常穿透到窗口。
  // ⚠️ 放在所有 hook 之后（React 的 hook 顺序要求）；设置入口在侧栏「鲸鱼」球，
  // 那颗球长在竖条上，不受这里影响，所以关了照样能打开。
  if (!visible) return null

  const rows = content?.kind === 'text' ? content.rows : []
  return (
    <div
      aria-hidden='true'
      data-os-whale=''
      // ⚠️ 层级 = **桌面装饰层**，和磁贴/小组件同级（2026-09-15：「鲸鱼应该是和
      //   小组件一个等级的」）：
      //     桌面磁贴/小组件（流内元素，无 z）→ 鲸鱼 z-0 → 窗口 zIndex 10~45
      //     （os-windows-store.ts 的 Z_BASE=10 / Z_CAP=45）→ 弹窗/遮罩 z-50
      //     → Dock z-70 / 竖条球弹层 z-80。
      //   z-0 就够：窗口最低也从 10 起，必然把鲸鱼盖住；桌面内容是流内元素，鲸鱼照旧压在它上面。
      // 沿革：z-[60]（浮在弹窗和遮罩上，2026-09-14 review 抓到）→ z-40（压在窗口上，
      //   挡住窗口内容的点击）→ z-0（跟随桌面层，被窗口盖住）。
      // ⚠️ 动这个值时**必须同步看命中判定**：挂件靠 document 级坐标命中吞点击，
      //   被更高层盖住时必须放行（`whaleIsExposed`），否则被盖住的地方会幽灵吞点击。
      className='pointer-events-none fixed right-0 bottom-0 z-0 select-none'
      style={
        {
          width: base,
          height: base,
          '--whale-u': `calc(${base} / ${DESIGN})`,
        } as React.CSSProperties
      }
    >
      <div
        ref={bodyRef}
        className='absolute top-0 left-0 h-full w-full'
        style={{
          transform: pressed ? SQUISH : undefined,
          transformOrigin: '50% 100%',
          transition: 'transform .22s cubic-bezier(.34,1.56,.64,1)',
        }}
      >
        <img
          ref={imageRef}
          src={WHALE_IMAGE}
          alt=''
          draggable={false}
          className='absolute right-0 bottom-0 block h-[59.45%] w-[59.45%]'
        />

        {/* 气泡：白底手绘泡 + 两条尾巴（原版 SVG 原样搬运） */}
        <div
          onClick={open ? closeBubble : undefined}
          className={cn(
            'absolute top-0 left-0 aspect-[1026/700] w-full',
            open ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          <svg
            viewBox='0 0 1026 700'
            preserveAspectRatio='xMidYMid meet'
            className='block h-full w-full'
          >
            <path
              d='M 827 248 A 373 232 0 1 0 81 246 A 373 232 0 0 0 301 465 A 57 32 10 0 0 413 484 A 373 232 0 0 0 827 248 Z'
              fill='#FFFFFF'
              stroke={INK}
              strokeWidth={18}
              strokeLinejoin='round'
              strokeLinecap='round'
              className='origin-center transition-[opacity,transform] duration-200'
              style={{
                transformBox: 'fill-box',
                opacity: open ? 1 : 0,
                transform: open ? 'none' : 'scale(.7)',
                // 展开顺序：先尾巴尖(b2) → 再内层(b1) → 最后大泡(shape)
                transitionDelay: open ? '0.26s' : '0.1s',
              }}
            />
            <ellipse
              cx={352}
              cy={561}
              rx={37.5}
              ry={26}
              fill='#FFFFFF'
              stroke={INK}
              strokeWidth={18}
              className='origin-center transition-[opacity,transform] duration-200'
              style={{
                transformBox: 'fill-box',
                opacity: open ? 1 : 0,
                transform: open ? 'none' : 'scale(.7)',
                transitionDelay: open ? '0.13s' : '0.2s',
              }}
            />
            <ellipse
              cx={442}
              cy={646}
              rx={24.5}
              ry={18}
              fill='#FFFFFF'
              stroke={INK}
              strokeWidth={18}
              className='origin-center transition-[opacity,transform] duration-200'
              style={{
                transformBox: 'fill-box',
                opacity: open ? 1 : 0,
                transform: open ? 'none' : 'scale(.7)',
                transitionDelay: open ? '0s' : '0.3s',
              }}
            />
          </svg>

          {content?.kind === 'gif' ? (
            <img
              src={WHALE_GIF}
              alt=''
              draggable={false}
              onError={() => {
                // 动图挂了（缺素材/网络）：降级成一句台词，别留一个空白的白气泡
                setContent((current) =>
                  current?.kind === 'gif' ? pickWhaleGifFailBubble() : current
                )
              }}
              className='absolute block -translate-x-1/2 -translate-y-1/2 object-contain transition-opacity duration-200'
              style={{
                left: '44.25%',
                top: '38%',
                maxWidth: 'calc(var(--whale-u) * 560)',
                maxHeight: 'calc(var(--whale-u) * 400)',
                opacity: open ? 1 : 0,
              }}
            />
          ) : null}

          <div
            className='absolute -translate-x-1/2 -translate-y-1/2 text-center transition-opacity duration-200'
            style={{
              left: '44.25%',
              top: '38%',
              // ⚠️ 必须给个宽度：绝对定位在 left:44.25% 时，可用宽度只剩"容器宽 - 166px"（≈209px），
              // 长台词会被这个上限挤成两行（原版 560u≈205px 正好卡在这个可用宽度上）。
              // 显式给 700u 再靠 translate 居中，长句才有地方摊开（气泡内圈最窄也有 ~740u）。
              width: 'calc(var(--whale-u) * 700)',
              color: TEXT_INK,
              opacity: open && content?.kind === 'text' ? 1 : 0,
              transitionDelay: open ? '0.36s' : '0s',
            }}
          >
            {rows.map((line) =>
              // 一次只可能有一行（数据面已砍），用台词本身当 key —— 槽位下标当 key 会被 lint 拦
              line ? (
                <p key={line.t} style={lineStyle(line)}>
                  {line.t}
                </p>
              ) : null
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
