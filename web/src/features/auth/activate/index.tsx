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
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { activateAccount } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/auth-layout'
import { isAuthUser } from '@/lib/auth-session'
import { useAuthStore } from '@/stores/auth-store'

export function Activate() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.auth.setUser)
  const [inviteCode, setInviteCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = inviteCode.trim()
    if (!code) {
      toast.error(t('Enter your invitation code'))
      return
    }
    setIsSubmitting(true)
    try {
      const res = await activateAccount(code)
      if (res?.success && isAuthUser(res.data)) {
        setUser(res.data)
        toast.success(t('Activated successfully'))
        navigate({ to: '/dashboard', replace: true })
      } else {
        toast.error(res?.message || t('Activation failed'))
      }
    } catch {
      // 错误由全局拦截器处理
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <div className='w-full space-y-6'>
        <div className='space-y-2 text-center'>
          <h2 className='text-2xl font-semibold tracking-tight'>
            {t('Activate Account')}
          </h2>
          <p className='text-muted-foreground text-sm'>
            {t(
              'This site requires an invitation code to activate your account'
            )}
          </p>
        </div>
        <form onSubmit={handleSubmit} className='grid gap-4'>
          <div className='grid gap-2'>
            <Label htmlFor='invite-code'>{t('Invitation Code')}</Label>
            <Input
              id='invite-code'
              placeholder={t('Enter your invitation code')}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete='off'
              disabled={isSubmitting}
            />
          </div>
          <Button
            type='submit'
            disabled={isSubmitting}
            className='mt-2 w-full justify-center gap-2'
          >
            {isSubmitting ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
            {t('Activate')}
          </Button>
        </form>
      </div>
    </AuthLayout>
  )
}
