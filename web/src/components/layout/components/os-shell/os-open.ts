// @muw-owned
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'

/**
 * OS 桌面壳开窗能力(宿主注入):
 * authenticated-layout 桌面分支挂载 window.__osShellOpenWindow,
 * 全局组件(头像菜单/搜索)通过它把"路由跳转"转成"开新窗口"。
 * 故意走 window 注入而非模块 import——command-menu/profile-dropdown
 * 经 os-open → use-os-nav 的模块链会形成跨 chunk 循环依赖,
 * 打包后绑定丢失(ReferenceError)。
 */
export type OsShellOpenWindow = (url: string) => void

export function getOsShellOpenWindow(): OsShellOpenWindow | undefined {
  return (window as unknown as { __osShellOpenWindow?: OsShellOpenWindow })
    .__osShellOpenWindow
}

/**
 * 环境感知跳转:
 * - 桌面壳(宿主注入存在):openWindow 开新窗口
 * - iframe 内容/移动端/默认布局:正常路由跳转(传 fallback 用调用方原逻辑)
 */
export function useOsShellNavigate() {
  const navigate = useNavigate()

  return useCallback((url: string, fallback?: () => void) => {
    const open = getOsShellOpenWindow()
    if (open) {
      open(url)
      return
    }
    if (fallback) {
      fallback()
      return
    }
    navigate({ to: url } as never)
  }, [navigate])
}
