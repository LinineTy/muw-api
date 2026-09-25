// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getOAuthStats, type OAuthStats } from './api'
import { ApplyApplicationDialog } from './components/apply-application-dialog'
import { AuthorizationsTable } from './components/authorizations-table'
import { MyApplicationsTable } from './components/my-applications-table'
import { ReviewQueueTable } from './components/review-queue-table'
import { OAuthStatsCards } from './components/stats-cards'
import { OAUTH_QUERY_KEY } from './constants'

const EMPTY_STATS: OAuthStats = {
  applications: 0,
  authorizations: 0,
  token_issued: 0,
  last_issued_at: 0,
  active_users: 0,
}

// 第三方应用控制台：统计 + 我的应用 + 授权记录；管理员多一个审核队列页签。
export function OAuthApplicationsPage() {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const isAdmin = role >= ROLE.ADMIN
  const [scope, setScope] = useState<'self' | 'all'>('self')
  const [tab, setTab] = useState('applications')
  const [applyOpen, setApplyOpen] = useState(false)

  const statsQuery = useQuery({
    queryKey: [...OAUTH_QUERY_KEY, 'stats', scope],
    queryFn: () => getOAuthStats(scope),
  })

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Developer applications')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          {isAdmin ? (
            <ToggleGroup
              value={[scope]}
              onValueChange={(value) => {
                // 单选：取新点中的那一个。
                const next = value.find((item) => item !== scope)
                if (next) setScope(next as 'self' | 'all')
              }}
              aria-label={t('Statistics')}
            >
              <ToggleGroupItem value='self'>{t('Only mine')}</ToggleGroupItem>
              <ToggleGroupItem value='all'>{t('Site-wide')}</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          <Button onClick={() => setApplyOpen(true)}>
            {t('Apply for a new application')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-3'>
            <OAuthStatsCards stats={statsQuery.data ?? EMPTY_STATS} />
            <Tabs
              value={tab}
              onValueChange={setTab}
              className='flex min-h-0 flex-1 flex-col gap-3'
            >
              <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
                <TabsTrigger value='applications'>
                  {t('My applications')}
                </TabsTrigger>
                <TabsTrigger value='authorizations'>
                  {t('Authorization records')}
                </TabsTrigger>
                {isAdmin ? (
                  <TabsTrigger value='review'>
                    {t('Application review')}
                  </TabsTrigger>
                ) : null}
              </TabsList>
              <TabsContent value='applications' className='min-h-0 flex-1'>
                <MyApplicationsTable />
              </TabsContent>
              <TabsContent value='authorizations' className='min-h-0 flex-1'>
                <AuthorizationsTable />
              </TabsContent>
              {isAdmin ? (
                <TabsContent value='review' className='min-h-0 flex-1'>
                  <ReviewQueueTable />
                </TabsContent>
              ) : null}
            </Tabs>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ApplyApplicationDialog open={applyOpen} onOpenChange={setApplyOpen} />
    </>
  )
}
