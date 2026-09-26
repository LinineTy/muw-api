// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getOAuthStats, type OAuthStats } from './api'
import { AccessLogsTable } from './components/access-logs-table'
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

// 第三方应用控制台：左侧统计（管理员可切全站/仅自己），右侧页签 =
// 我的应用 / 授权记录 / 审核队列（仅管理员）。
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
            <Tabs
              value={scope}
              onValueChange={(value) => setScope(value as 'self' | 'all')}
            >
              <TabsList>
                <TabsTrigger value='all'>{t('All')}</TabsTrigger>
                <TabsTrigger value='self'>{t('Only Mine')}</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          <Button onClick={() => setApplyOpen(true)}>
            {t('Apply for a new application')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='grid h-full min-h-0 gap-4 sm:gap-5 lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)]'>
            <aside aria-label={t('Statistics')} className='min-w-0'>
              <OAuthStatsCards
                stats={statsQuery.data ?? EMPTY_STATS}
                className='grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-1'
              />
            </aside>
            <Tabs
              value={tab}
              onValueChange={setTab}
              className='flex min-h-0 flex-col gap-3'
            >
              <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
                <TabsTrigger value='applications'>
                  {t('My applications')}
                </TabsTrigger>
                <TabsTrigger value='authorizations'>
                  {t('Authorization records')}
                </TabsTrigger>
                <TabsTrigger value='calls'>{t('Call records')}</TabsTrigger>
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
              <TabsContent value='calls' className='min-h-0 flex-1'>
                <AccessLogsTable />
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
