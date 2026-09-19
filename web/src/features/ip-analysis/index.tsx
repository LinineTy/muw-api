// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { Radar } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  DataTableColumnHeader,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getRouteApi } from '@tanstack/react-router'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { getIpRank, getIpUserRank, getUserIpDetail } from './api'
import type { IpRankRow, IpUserRankRow, UserIpDetailRow } from './types'
import { formatTime } from './lib'

const route = getRouteApi('/_authenticated/ip-analysis/')


export function IpAnalysis() {
  const { t } = useTranslation()
  const [days, setDays] = useState(30)
  const [ipVersion, setIpVersion] = useState('all')
  const DAY_OPTIONS = [
    { value: 7, label: t('7 Days') },
    { value: 30, label: t('30 Days') },
    { value: 90, label: t('90 Days') },
  ]
  const IP_VERSION_OPTIONS = [
    { value: 'all', label: t('All IPs') },
    { value: 'v4', label: t('IPv4 only') },
    { value: 'v6', label: t('IPv6 only') },
  ]

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <Radar className='size-4' aria-hidden='true' />
          <span className='truncate'>{t('IP Analysis')}</span>
          <Badge variant='outline' className='shrink-0'>
            Root
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Select items={DAY_OPTIONS} value={days} onValueChange={(value) => setDays(Number(value))}>
          <SelectTrigger className='h-9'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {DAY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className='whitespace-nowrap'>{opt.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={IP_VERSION_OPTIONS}
          value={ipVersion}
          onValueChange={(value) => setIpVersion(String(value))}
        >
          <SelectTrigger className='h-9'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {IP_VERSION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className='whitespace-nowrap'>{opt.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>

        <Tabs defaultValue='users'>
          <TabsList>
            <TabsTrigger value='users'>{t('By User')}</TabsTrigger>
            <TabsTrigger value='ips'>{t('By IP')}</TabsTrigger>
          </TabsList>
          <TabsContent value='users'>
            <UserIpTable days={days} ipVersion={ipVersion} />
          </TabsContent>
          <TabsContent value='ips'>
            <IpUserTable days={days} ipVersion={ipVersion} />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function UserIpTable(props: { days: number; ipVersion: string }) {
  const { t } = useTranslation()
  const [detailUserId, setDetailUserId] = useState<number | null>(null)

  const {
    globalFilter,
    onGlobalFilterChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'min_ips' },
    columnFilters: [],
  })
  const minIps = Number(globalFilter?.trim()) || 1

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'ip-analysis-users',
      props.days,
      props.ipVersion,
      minIps,
      pagination.pageIndex,
    ],
    queryFn: () =>
      getIpUserRank({
        days: props.days,
        min_ips: minIps,
        ip_version: props.ipVersion,
        page: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo(
    () => [
      {
        accessorKey: 'username',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('User')} />
        ),
        cell: ({ row }: { row: { original: IpUserRankRow } }) => (
          <span className='font-medium'>
            {row.original.username}
            {row.original.display_name
              ? ` (${row.original.display_name})`
              : ''}
          </span>
        ),
      },
      {
        accessorKey: 'ip_count',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('IP Count')} />
        ),
        cell: ({ row }: { row: { original: IpUserRankRow } }) => (
          <Badge
            variant={row.original.ip_count >= 10 ? 'destructive' : 'secondary'}
          >
            {row.original.ip_count}
          </Badge>
        ),
      },
      {
        accessorKey: 'request_count',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('Requests')} />
        ),
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }: { row: { original: IpUserRankRow } }) =>
          row.original.status === 1 ? t('Enabled') : t('Disabled'),
      },
      {
        accessorKey: 'last_seen',
        header: t('Last Seen'),
        cell: ({ row }: { row: { original: IpUserRankRow } }) =>
          formatTime(row.original.last_seen),
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }: { row: { original: IpUserRankRow } }) => (
          <button
            type='button'
            className='text-primary hover:underline'
            onClick={() => setDetailUserId(row.original.user_id)}
          >
            {t('View IPs')}
          </button>
        ),
      },
    ],
    [t]
  )

  const table = useDataTable({
    data: data?.data?.items ?? [],
    columns: columns as never,
    totalCount: data?.data?.total ?? 0,
    globalFilter,
    pagination,
    globalFilterFn: () => true,
    onGlobalFilterChange,
    onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    ensurePageInRange,
  })

  return (
    <>
      <DataTablePage
        table={table.table}
        columns={columns as never}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No data')}
        toolbarProps={{
          searchPlaceholder: t('Min IPs'),
          searchDebounceMs: 500,
        }}
      />
      <UserIpDetailDialog
        userId={detailUserId}
        days={props.days}
        ipVersion={props.ipVersion}
        onClose={() => setDetailUserId(null)}
      />
    </>
  )
}

function IpUserTable(props: { days: number; ipVersion: string }) {
  const { t } = useTranslation()

  const {
    globalFilter,
    onGlobalFilterChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'min_users' },
    columnFilters: [],
  })
  const minUsers = Number(globalFilter?.trim()) || 1

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'ip-analysis-ips',
      props.days,
      props.ipVersion,
      minUsers,
      pagination.pageIndex,
    ],
    queryFn: () =>
      getIpRank({
        days: props.days,
        min_users: minUsers,
        ip_version: props.ipVersion,
        page: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo(
    () => [
      {
        accessorKey: 'ip',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('IP')} />
        ),
        cell: ({ row }: { row: { original: IpRankRow } }) => (
          <span className='font-mono text-sm'>{row.original.ip}</span>
        ),
      },
      {
        accessorKey: 'user_count',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('Linked Users')} />
        ),
        cell: ({ row }: { row: { original: IpRankRow } }) => (
          <Badge
            variant={
              row.original.user_count >= 5 ? 'destructive' : 'secondary'
            }
          >
            {row.original.user_count}
          </Badge>
        ),
      },
      {
        accessorKey: 'request_count',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('Requests')} />
        ),
      },
      {
        accessorKey: 'last_seen',
        header: t('Last Seen'),
        cell: ({ row }: { row: { original: IpRankRow } }) =>
          formatTime(row.original.last_seen),
      },
    ],
    [t]
  )

  const table = useDataTable({
    data: data?.data?.items ?? [],
    columns: columns as never,
    totalCount: data?.data?.total ?? 0,
    globalFilter,
    pagination,
    globalFilterFn: () => true,
    onGlobalFilterChange,
    onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    ensurePageInRange,
  })

  return (
    <DataTablePage
      table={table.table}
      columns={columns as never}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No data')}
      toolbarProps={{
        searchPlaceholder: t('Min Users'),
        searchDebounceMs: 500,
      }}
    />
  )
}

function UserIpDetailDialog(props: {
  userId: number | null
  days: number
  ipVersion: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const open = props.userId !== null

  const { data, isLoading } = useQuery({
    queryKey: [
      'ip-analysis-user-detail',
      props.userId,
      props.days,
      props.ipVersion,
    ],
    queryFn: () =>
      getUserIpDetail({
        user_id: props.userId as number,
        days: props.days,
        ip_version: props.ipVersion,
      }),
    enabled: open,
  })

  const rows: UserIpDetailRow[] = data?.data ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent className='max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {t('User IPs')} · UID {props.userId}
          </DialogTitle>
        </DialogHeader>
        <div className='max-h-[50vh] overflow-y-auto'>
          {(() => {
            if (isLoading) {
              return (
                <div className='text-muted-foreground py-6 text-center text-sm'>
                  {t('Loading...')}
                </div>
              )
            }
            if (rows.length === 0) {
              return (
                <div className='text-muted-foreground py-6 text-center text-sm'>
                  {t('No data')}
                </div>
              )
            }
            return (
              <div className='grid gap-1'>
                {rows.map((r) => (
                  <div
                    key={r.ip}
                    className='flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm'
                  >
                    <span className='font-mono'>{r.ip}</span>
                    <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                      {r.request_count} · {formatTime(r.last_seen)}
                    </span>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
