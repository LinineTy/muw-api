// @muw-owned
import { useSearch } from '@tanstack/react-router'

import { AuthLayout } from '../auth-layout'
import { LoginResultScreen } from './login-result-screen'

export function LoginResult() {
  const search = useSearch({ from: '/(auth)/login-result' })
  return (
    <AuthLayout>
      <LoginResultScreen search={search} />
    </AuthLayout>
  )
}
