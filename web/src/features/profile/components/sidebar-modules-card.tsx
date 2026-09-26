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
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

type SidebarModuleConfig = {
  enabled: boolean
  [key: string]: boolean
}

type SidebarModulesConfig = Record<string, SidebarModuleConfig>

type SectionDef = {
  key: string
  title: string
  description: string
  modules: { key: string; title: string; description: string }[]
}

export function SidebarModulesCard() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState<SidebarModulesConfig>({})
  const currentUser = useAuthStore((s) => s.auth.user)
  const setUser = useAuthStore((s) => s.auth.setUser)
  // 管理员/超管才显示 admin 与 addon 区（普通用户侧边栏无这些项）。
  const isAdminRole = (currentUser?.role ?? ROLE.USER) >= ROLE.ADMIN

  const baseSectionDefs: SectionDef[] = [
    {
      key: 'chat',
      title: t('Chat Area'),
      description: t('Playground and chat functions'),
      modules: [
        {
          key: 'playground',
          title: t('Chat'),
          description: t('AI model testing environment'),
        },
        {
          key: 'chat',
          title: t('Third-party Integration'),
          description: t('Chat session management'),
        },
      ],
    },
    {
      key: 'console',
      title: t('General Area'),
      description: t('Data management and log viewing'),
      modules: [
        {
          key: 'detail',
          title: t('Dashboard'),
          description: t('System data statistics'),
        },
        {
          key: 'token',
          title: t('Token Management'),
          description: t('API token management'),
        },
        {
          key: 'log',
          title: t('Usage Logs'),
          description: t('API usage records'),
        },
        {
          key: 'audit',
          title: t('Audit Logs'),
          description: t('Login, security and access records'),
        },
        {
          key: 'midjourney',
          title: t('Drawing Logs'),
          description: t('Drawing task records'),
        },
        {
          key: 'task',
          title: t('Task Logs'),
          description: t('System task records'),
        },
        {
          key: 'model_health',
          title: t('Model Health'),
          description: t('Track per-model success rate and latency trends.'),
        },
      ],
    },
    {
      key: 'personal',
      title: t('Personal Center Area'),
      description: t('User personal functions'),
      modules: [
        {
          key: 'topup',
          title: t('Wallet Management'),
          description: t('Balance and top-up management'),
        },
        {
          key: 'orders',
          title: t('Order Center'),
          description: t(
            'Recharge, subscription and cloud space purchase orders.'
          ),
        },
        {
          key: 'personal',
          title: t('Personal Settings'),
          description: t('Personal info settings'),
        },
        {
          key: 'security',
          title: t('Security & Access'),
          description: t('Manage your security settings and account access'),
        },
      ],
    },
  ]

  // 管理区（admin/addon）仅对管理员/超管展示。
  const adminSectionDefs: SectionDef[] = isAdminRole
    ? [
        {
          key: 'admin',
          title: t('Admin area'),
          description: t('Global configuration and administrative tools.'),
          modules: [
            {
              key: 'channel',
              title: t('Channels'),
              description: t('Configure upstream providers and routing.'),
            },
            {
              key: 'models',
              title: t('Models'),
              description: t('Manage catalog visibility and pricing.'),
            },
            {
              key: 'user',
              title: t('Users'),
              description: t('Administer user accounts and roles.'),
            },
            {
              key: 'redemption',
              title: t('Redemption Codes'),
              description: t('Create and review invite or credit codes.'),
            },
            {
              key: 'subscription',
              title: t('Subscriptions'),
              description: t('Manage subscription plans and pricing.'),
            },
            {
              key: 'system_info',
              title: t('System Info'),
              description: t('Monitor system instances and background tasks.'),
            },
            {
              key: 'operations_stats',
              title: t('Operations Stats'),
              description: t(
                'Cross-instance traffic, user growth and ranking trends.'
              ),
            },
            {
              key: 'task_plugins',
              title: t('Task Plugins'),
              description: t(
                'Review the registered task plugins and their bindings.'
              ),
            },
            {
              key: 'setting',
              title: t('System Settings'),
              description: t('Advanced platform configuration.'),
            },
          ],
        },
        {
          key: 'addon',
          title: t('Add-ons'),
          description: t('Additional tools and utilities.'),
          modules: [
            {
              key: 'image_host',
              title: t('Image Host'),
              description: t('Upload and manage images used by themes.'),
            },
            {
              key: 'risk_control',
              title: t('Risk Control'),
              description: t(
                'Credit score, conversation retention and marker analysis.'
              ),
            },
            {
              key: 'ip_analysis',
              title: t('IP Analysis'),
              description: t(
                'Activity rankings and overlap between users and IP addresses.'
              ),
            },
          ],
        },
      ]
    : []

  const sectionDefs = [...baseSectionDefs, ...adminSectionDefs]

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.get('/api/user/self')
      if (res.data.success && res.data.data?.sidebar_modules) {
        const raw = res.data.data.sidebar_modules
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        setConfig(parsed)
      } else {
        const defaults: SidebarModulesConfig = {}
        for (const sec of sectionDefs) {
          defaults[sec.key] = { enabled: true }
          for (const mod of sec.modules) defaults[sec.key][mod.key] = true
        }
        setConfig(defaults)
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const toggleSection = (sectionKey: string, val: boolean) => {
    setConfig((prev) => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], enabled: val },
    }))
  }

  const toggleModule = (
    sectionKey: string,
    moduleKey: string,
    val: boolean
  ) => {
    setConfig((prev) => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], [moduleKey]: val },
    }))
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      const serialized = JSON.stringify(config)
      const res = await api.put('/api/user/self', {
        sidebar_modules: serialized,
      })
      if (res.data.success) {
        // Sync to auth-store so useSidebarConfig re-runs and the sidebar
        // updates immediately without needing a page refresh.
        if (currentUser) {
          setUser({ ...currentUser, sidebar_modules: serialized })
        }
        toast.success(t('Saved successfully'))
      } else {
        handleServerError(res.data, t('Save failed'))
      }
    } catch (error) {
      handleServerError(error, t('Save failed, please retry'))
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    const defaults: SidebarModulesConfig = {}
    for (const sec of sectionDefs) {
      defaults[sec.key] = { enabled: true }
      for (const mod of sec.modules) defaults[sec.key][mod.key] = true
    }
    setConfig(defaults)
    toast.success(t('Reset to default configuration'))
  }

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
        <CardTitle className='text-sm font-semibold'>
          {t('Sidebar Personal Settings')}
        </CardTitle>
        <CardDescription className='text-xs sm:text-sm'>
          {t('Customize sidebar display content')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4 p-3 sm:space-y-5 sm:p-5'>
        {sectionDefs.map((section) => {
          const sectionEnabled = config[section.key]?.enabled !== false
          return (
            <div
              key={section.key}
              className='bg-background/60 rounded-xl border p-3'
            >
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <p className='text-sm font-medium'>{section.title}</p>
                  <p className='text-muted-foreground text-xs'>
                    {section.description}
                  </p>
                </div>
                <Switch
                  checked={sectionEnabled}
                  onCheckedChange={(v) => toggleSection(section.key, v)}
                />
              </div>
              <div className='mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1'>
                {section.modules.map((mod) => (
                  <div
                    key={mod.key}
                    className={`flex min-h-16 items-center justify-between rounded-lg border p-3 ${
                      sectionEnabled ? '' : 'opacity-50'
                    }`}
                  >
                    <div className='mr-2 min-w-0'>
                      <p className='truncate text-sm font-medium'>
                        {mod.title}
                      </p>
                      <p className='text-muted-foreground truncate text-xs'>
                        {mod.description}
                      </p>
                    </div>
                    <Switch
                      checked={config[section.key]?.[mod.key] !== false}
                      onCheckedChange={(v) =>
                        toggleModule(section.key, mod.key, v)
                      }
                      disabled={!sectionEnabled}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        <div className='flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end'>
          <Button variant='outline' onClick={handleReset}>
            {t('Reset to Default')}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? t('Saving...') : t('Save Changes')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
