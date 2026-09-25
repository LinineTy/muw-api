// @muw-owned
import { createFileRoute } from '@tanstack/react-router'

import { OAuthApplicationsPage } from '@/features/oauth-provider/applications-page'

// 站内用户自助页：申请第三方应用接入 + 管理自己给出的授权（挂 _authenticated ⇒ 自动要求登录）。
export const Route = createFileRoute('/_authenticated/oauth/applications')({
  component: OAuthApplicationsPage,
})
