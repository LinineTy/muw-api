// @muw-owned
import { createFileRoute } from '@tanstack/react-router'

import {
  OAuthConsentPage,
  type ConsentLayout,
} from '@/features/oauth-provider/consent-page'

// 对外提供 OIDC 身份验证时的授权确认页：后端 /oauth/authorize 校验完参数后把浏览器
// 送到这里（请求参数由服务端签名，页面只负责把它交回决策接口）。
// 放在 _authenticated 下 ⇒ 未登录会自动跳登录页并在登录后回到本页。
export const Route = createFileRoute('/_authenticated/oauth/consent')({
  validateSearch: (search: Record<string, unknown>) => ({
    request: typeof search.request === 'string' ? search.request : '',
    // 排布方案（对比用）：card=单卡 / stacked=居中分卡 / split=宽屏双栏
    layout: (search.layout === 'stacked' || search.layout === 'split'
      ? search.layout
      : 'card') as ConsentLayout,
  }),
  component: ConsentRoute,
})

function ConsentRoute() {
  const { request, layout } = Route.useSearch()
  return <OAuthConsentPage request={request} layout={layout} />
}
