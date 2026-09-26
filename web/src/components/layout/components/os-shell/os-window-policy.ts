// @muw-owned
/**
 * OS 桌面壳 · 窗口内导航策略。
 *
 * 窗口(iframe)里的页面跳转先经过这里裁决:
 * - `window` 就地开在当前窗口(壳管辖、且命中导航项的页面)
 * - `open`   开成一个新窗口(壳管辖、但不是导航项里的页面,如详情页)
 * - `host`   交回主层完整接管(设置页/协议端点/公开页/壳桌面/不存在的路径)
 *
 * 决策在主层做——它才有导航项与路由树;窗口侧只负责发起请求、并按结果取消
 * 自己的导航。两侧同源,能力挂在 window 上跨层取用,与 `os-open.ts` 的
 * `__osShellOpenWindow` 同一套注入方式。
 */
import { isSettingsUrl, isStandaloneProtocolUrl } from './os-open'

export type OsWindowAction = 'window' | 'open' | 'host'

/** beforeLoad 的触发原因(TanStack Router 的 `cause`) */
export type OsNavigateCause = 'preload' | 'enter' | 'stay'

/** 壳管辖的路由子树:窗口只服务这一支,其余(公开页/协议页/404)交回主层 */
export const SHELL_ROUTE_SUBTREE_ID = '/_authenticated'

export type OsWindowActionDeps = {
  /** 壳自身的桌面路径(窗口里再跳它没有意义,交回主层) */
  isShellHome: (pathname: string) => boolean
  /** 路径是否存在、以及是否属于壳管辖(`/_authenticated` 子树) */
  routeScope: (pathname: string) => { exists: boolean; inShell: boolean }
  /** 是否命中导航项 */
  hasNavItem: (pathname: string) => boolean
}

/** 拆出站内路径(去掉查询串),查询串由调用方自行保留 */
export function splitOsShellUrl(url: string) {
  const index = url.indexOf('?')
  if (index === -1) return { pathname: url, search: '' }
  return { pathname: url.slice(0, index), search: url.slice(index) }
}

export function resolveOsWindowAction(
  url: string,
  deps: OsWindowActionDeps
): OsWindowAction {
  const { pathname } = splitOsShellUrl(url)
  if (deps.isShellHome(pathname)) return 'host'
  if (isSettingsUrl(url) || isStandaloneProtocolUrl(url)) return 'host'
  const scope = deps.routeScope(pathname)
  if (!scope.exists || !scope.inShell) return 'host'
  return deps.hasNavItem(pathname) ? 'window' : 'open'
}

/** 主层注入的能力:请主层裁决并执行一次窗口内跳转 */
export type OsWindowNavigationBridge = (url: string) => OsWindowAction
/** 窗口上报的自身状态:地址之外还包括它在自己历史里能不能往回/往前 */
export type OsWindowSyncPayload = {
  canBack: boolean
  canForward: boolean
}

/** 主层注入的能力:窗口内跳转后回填窗口自身的 url、标题与历史可导航性 */
export type OsWindowSyncBridge = (
  id: string,
  url: string,
  history: OsWindowSyncPayload
) => void

/**
 * 让某个窗口在它自己的历史里后退/前进。
 *
 * 窗口内容是同源 iframe,直接操作它的 history 即可 —— 走的是它自己的路由,
 * 沿途 beforeLoad(含"这一跳该不该留在窗口里"的守卫)照常生效。
 */
export function navigateOsWindowHistory(id: string, delta: -1 | 1) {
  const frame = document.querySelector<HTMLIFrameElement>(
    `iframe[data-os-window-id="${id}"]`
  )
  if (!frame?.contentWindow) return
  if (delta === -1) frame.contentWindow.history.back()
  else frame.contentWindow.history.forward()
}

/**
 * 取壳宿主能力。主层读自己的 window,窗口 iframe 读父窗口(同源)——
 * 注入点始终在主层的 window 上。
 */
function getShellHostWindow(): Window | undefined {
  if (typeof window === 'undefined') return undefined
  return window.self === window.top ? window : window.parent
}

export function getOsWindowNavigationBridge():
  | OsWindowNavigationBridge
  | undefined {
  return (
    getShellHostWindow() as unknown as {
      __osShellWindowNavigation?: OsWindowNavigationBridge
    }
  )?.__osShellWindowNavigation
}

export function getOsWindowSyncBridge(): OsWindowSyncBridge | undefined {
  return (
    getShellHostWindow() as unknown as {
      __osShellSyncWindowUrl?: OsWindowSyncBridge
    }
  )?.__osShellSyncWindowUrl
}

/**
 * 窗口 iframe 内"上一次真正渲染出来"的地址。
 *
 * 不能拿 `window.location` 当当前地址:后退/前进(popstate)触发导航时,浏览器
 * 已经把地址改好了,拿它比会误判成"同址重入"从而放过;程序化导航(点击链接、
 * navigate)则相反——那时 location 还是旧的。两条路都得对,所以以渲染出来的
 * 地址为准(由布局层每次渲染后回填)。
 */
let windowHref = ''

export function rememberOsWindowHref(href: string) {
  windowHref = href
}

export function currentOsWindowHref(): string {
  if (windowHref) return windowHref
  // 首次加载:布局层还没回填,此时 location 就是本次要渲染的地址
  return `${window.location.pathname}${window.location.search}`
}

/**
 * 窗口 iframe 内的导航守卫:把目标交给主层裁决,返回 true 表示主层已接管
 * (开新窗/跳出壳),调用方应取消这次窗内导航留在原页。主层放行时返回 false。
 *
 * ⚠️ 预加载(`cause === 'preload'`,默认 `defaultPreload: 'intent'` 下鼠标划过
 * 链接就会触发)必须直接放行:预加载同样会走 beforeLoad,请求主层就等于把
 * "鼠标划过"变成了"跳转/开窗"。
 *
 * 目标与窗口当前地址相同时也直接放行 —— 取消导航靠"重定向回当前地址"实现,
 * 少了这道判断会在同址重入时打转。
 */
export function osWindowEscapesToHost(
  target: string,
  cause: OsNavigateCause = 'enter'
): boolean {
  if (cause === 'preload') return false
  if (typeof window === 'undefined' || window.self === window.top) return false
  if (target === currentOsWindowHref()) return false
  const decide = getOsWindowNavigationBridge()
  if (!decide) return false
  return decide(target) !== 'window'
}
