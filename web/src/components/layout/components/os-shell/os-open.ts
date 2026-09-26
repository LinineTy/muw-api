import { useNavigate } from '@tanstack/react-router'
// @muw-owned
import { useCallback } from 'react'

/**
 * OS 桌面壳开窗能力(宿主注入):
 * authenticated-layout 桌面分支挂载 window.__osShellOpenWindow,
 * 全局组件(头像菜单/搜索/导航球/空态网格)通过它把"路由跳转"转成"开新窗口"。
 * 返回 true = 已开窗处理;false = 宿主不处理(如设置页走主层完整布局),调用方回退路由。
 * 故意走 window 注入而非模块 import——经 use-os-nav 的模块链会形成
 * 跨 chunk 循环依赖,打包后绑定丢失(ReferenceError)。
 */
export type OsShellOpenWindow = (url: string) => boolean

/** 系统设置类页面:退出多窗口,始终走主层完整布局(仅管理员可见) */
export function isSettingsUrl(url: string) {
  return url.startsWith('/settings') || url.startsWith('/system-settings')
}

/** 协议端点(授权同意页 / 第三方登录回调)不该被壳接管:
 *  它们的参数就是协议状态(state/request),渲染进窗口会打断授权流程,
 *  所以始终独立成页(与设置页一样走主层布局)。注意排除控制台页面 /oauth/applications。 */
export function isStandaloneProtocolUrl(url: string) {
  const path = url.split('?')[0]
  if (path === '/oauth/consent') return true
  return /^\/oauth\/[^/]+$/.test(path) && path !== '/oauth/applications'
}

export function getOsShellOpenWindow(): OsShellOpenWindow | undefined {
  return (window as unknown as { __osShellOpenWindow?: OsShellOpenWindow })
    .__osShellOpenWindow
}

/**
 * 环境感知跳转:
 * - 桌面壳且非设置页:openWindow 开新窗口
 * - 设置页/iframe 内容/移动端/默认布局:正常路由跳转(传 fallback 用调用方原逻辑)
 */
export function useOsShellNavigate() {
  const navigate = useNavigate()

  return useCallback(
    (url: string, fallback?: () => void): boolean => {
      const open = getOsShellOpenWindow()
      if (open?.(url)) return true
      if (fallback) {
        fallback()
        return true
      }
      navigate({ to: url } as never)
      return true
    },
    [navigate]
  )
}
