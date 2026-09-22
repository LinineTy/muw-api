/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useEffect } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { ThemeCustomizationProvider } from '@/context/theme-customization-provider'
import { saveAffiliateCode } from '@/features/auth/lib/storage'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'
import { getSetupStatus } from '@/features/setup/api'
import { useSystemConfig } from '@/hooks/use-system-config'
import {
  APP_LOADING_TIMING,
  appLoadingCycleMs,
  readSplashRound,
  splashRoundEndAt,
} from '@/lib/app-loading'
import {
  bootstrapAuthentication,
  clearAuthenticatedClientState,
  clearAuthentication,
} from '@/lib/auth-session'
import { subscribeAuthSessionEvents } from '@/lib/auth-session-sync'
import { resolveLegacyRoute } from '@/lib/legacy-route'
import { useAppBackground } from '@/lib/use-app-background'
import { useAuthStore } from '@/stores/auth-store'

/** 错误页不需要首屏占位:进来立刻撤掉,别让它靠 10s 兜底才消失 */
function RootErrorComponent(props: { error?: unknown }) {
  useEffect(() => {
    document.querySelector('#app-loading')?.remove()
  }, [])
  return <GeneralError error={props.error} />
}

function RootComponent() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const routerStatus = useRouterState({ select: (state) => state.status })

  // Load system configuration (logo, system name, etc.) from backend
  useSystemConfig({ autoLoad: true })
  // 把后台配置的全局背景图同步到 body 内联 CSS 变量(液态玻璃预设消费)
  useAppBackground()

  // 首屏占位(index.html 里的 #app-loading,os 窗体里则是滚动圆)到这里才撤:
  // 挂载 + 首个路由解析完成前页面只有它,撤早了就是「壁纸全空 + 顶部进度条」。
  //
  // ⚠️ 一轮「逐字上浮」必须播完再放行(2026-09-22 maintainer要求):加载再快也不许在
  // 单轮中途抽走占位——以「首字起浮 → 末字落定(含余韵)」为一轮,不看这是第几次
  // 打开、第几轮,当前这轮没走完就等它走完。已经在页面里挂了很久(冷启动那种,
  // 一轮早就过去)则 hold = 0,立刻淡出。
  useEffect(() => {
    if (routerStatus !== 'idle') return
    const splash = document.querySelector<HTMLElement>('#app-loading')
    if (!splash) return

    // ⚠️ 锚点必须用内联占位量到的「首帧 + 末字落定」,不能拿 performance.now() 直接减一轮:
    // 动画的时钟从浏览器首次渲染起算、performance.now() 从导航起算,冷加载时两者差上百
    // 毫秒到一秒多,直接减就会把这一轮截断(2026-09-22 线上实测:热加载被切末字、
    // reduce-motion 下整轮一闪而过)。无动画时改用最短留屏时长。
    const letterCount = splash.querySelectorAll('.brand span').length
    const round = readSplashRound()
    const hold = Math.max(
      0,
      (round
        ? splashRoundEndAt(round, letterCount)
        : appLoadingCycleMs(letterCount)) - performance.now()
    )

    let removeTimer: number | undefined
    const leaveTimer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>('#app-loading')
      if (!el) return
      el.classList.add('app-loading-leave')
      removeTimer = window.setTimeout(() => {
        document.querySelector('#app-loading')?.remove()
      }, APP_LOADING_TIMING.fadeMs)
    }, hold)

    return () => {
      window.clearTimeout(leaveTimer)
      if (removeTimer !== undefined) window.clearTimeout(removeTimer)
    }
  }, [routerStatus])

  useEffect(() => {
    const aff = new URLSearchParams(window.location.search).get('aff')?.trim()
    if (aff) {
      saveAffiliateCode(aff)
    }
  }, [])

  useEffect(
    () =>
      useAuthStore.subscribe((state, previousState) => {
        const sid = state.auth.session?.sid
        const previousSID = previousState.auth.session?.sid
        if (sid !== previousSID) {
          queryClient.clear()
        }
      }),
    [queryClient]
  )

  useEffect(
    () =>
      subscribeAuthSessionEvents((event) => {
        const currentSID = useAuthStore.getState().auth.session?.sid

        if (event.kind === 'authenticated') {
          if (event.sid === currentSID) return
          if (currentSID) {
            clearAuthentication(false)
          }
          window.location.reload()
          return
        }

        if (currentSID && event.sid === currentSID) {
          clearAuthenticatedClientState(queryClient, false)
          void navigate({ to: '/sign-in', replace: true })
        }
      }),
    [navigate, queryClient]
  )

  return (
    <ThemeCustomizationProvider>
      <Outlet />
      <Toaster closeButton duration={5000} position='top-center' richColors />
      {import.meta.env.MODE === 'development' && (
        <>
          <ReactQueryDevtools buttonPosition='bottom-left' />
          <TanStackRouterDevtools position='bottom-right' />
        </>
      )}
    </ThemeCustomizationProvider>
  )
}

// 同一页面会话内避免重复检查；刷新后重新校验当前服务实例。
let setupStatusChecked = false

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  // 应用初始化与路由解析前统一校验会话
  beforeLoad: async ({ location }) => {
    const legacyTarget = resolveLegacyRoute(location.href)
    if (legacyTarget) {
      throw redirect({ href: legacyTarget, replace: true })
    }

    const pathname = location?.pathname || ''
    const needsSetupCheck =
      !setupStatusChecked && !pathname.startsWith('/setup')
    const authBootstrap = bootstrapAuthentication()

    // 只检查 setup 状态（如果需要）
    if (needsSetupCheck) {
      const [status] = await Promise.all([
        getSetupStatus().catch((error) => {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn('[root.beforeLoad] setup status check failed', error)
          }
          return null
        }),
        authBootstrap,
      ])

      if (status?.success && status.data) {
        if (!status.data.status) {
          throw redirect({ to: '/setup' })
        }
        setupStatusChecked = true
      }
    } else {
      await authBootstrap
    }
  },
  component: RootComponent,
  notFoundComponent: NotFoundError,
  errorComponent: RootErrorComponent,
})
