/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Brain, Eye, Save, ShieldAlert, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTableColumnHeader,
  DataTablePage,
  useDebouncedColumnFilter,
  useDataTable,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { User } from '@/features/users/types'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import {
  acceptMarkerSuggestion,
  adjustCreditScore,
  analyzeMarkers,
  getConversationRecord,
  getConversationRecords,
  getCreditScoreLogs,
  getLowScoreUsers,
  getMarkerSuggestions,
  getMarkers,
  getRiskControlOverview,
  rejectMarkerSuggestion,
  updateMarkers,
} from './api'
import type {
  ConversationRecord,
  CreditScoreLog,
  MarkerSuggestion,
} from './types'

const route = getRouteApi('/_authenticated/risk-control/')

function formatTs(ts?: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString()
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  )
  const value = bytes / 1024 ** i
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

// extractThinkBlocks 把内容里内联的 <think>…</think> 块抽出来归为思考（部分模型把思考
// 直接写进 delta.content，而不是 reasoning_content）；未闭合的 <think>（流被截断）也归入思考。
function extractThinkBlocks(text: string): { thinking: string; content: string } {
  let thinking = ''
  const content = text.replaceAll(/<think>([\s\S]*?)<\/think>/g, (_m, inner: string) => {
    thinking += inner
    return ''
  })
  const openIdx = content.indexOf('<think>')
  if (openIdx !== -1) {
    thinking += content.slice(openIdx + 7).trim()
    return { thinking: thinking.trim(), content: content.slice(0, openIdx).trim() }
  }
  return { thinking: thinking.trim(), content: content.trim() }
}

// parseConversationResponse 把存储的原始响应解析成可读文本（仅展示层，不改存储）：
// 返回 { thinking, content }，思考（reasoning_content 或内联 <think> 块）与回复内容分开。
// - SSE 流：逐行取 data 帧的 choices[0].delta.content（回复）与 delta.reasoning_content（思考）；
// - 非流式 JSON：取 choices[0].message.content / reasoning_content；
// - 解析不了就原样放进 content。
function parseConversationResponse(raw: string): {
  thinking: string
  content: string
} {
  const trimmed = raw.trim()
  if (!trimmed) return { thinking: '', content: '' }

  const isSSE = trimmed.startsWith('data: ') || trimmed.includes('\ndata: ')
  if (isSSE) {
    const thinkingParts: string[] = []
    const contentParts: string[] = []
    for (const line of trimmed.split('\n')) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const payload = s.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const obj = JSON.parse(payload) as {
          type?: string
          choices?: Array<{
            delta?: { content?: unknown; reasoning_content?: unknown }
          }>
          delta?: { text?: unknown; thinking?: unknown }
          content_block?: { type?: string; thinking?: unknown }
        }
        const delta = obj.choices?.[0]?.delta
        if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
          thinkingParts.push(delta.reasoning_content)
        }
        if (typeof delta?.content === 'string' && delta.content) {
          contentParts.push(delta.content)
        }
        // Claude 原生 SSE：content_block_delta 帧里 text_delta / thinking_delta 直接挂在
        // delta.* 上（无 choices 结构），thinking 帧则在 content_block_start/delta。
        if (typeof obj.delta?.text === 'string' && obj.delta.text) {
          contentParts.push(obj.delta.text)
        }
        if (typeof obj.delta?.thinking === 'string' && obj.delta.thinking) {
          thinkingParts.push(obj.delta.thinking)
        }
        if (
          obj.content_block?.type === 'thinking' &&
          typeof obj.content_block.thinking === 'string' &&
          obj.content_block.thinking
        ) {
          thinkingParts.push(obj.content_block.thinking)
        }
      } catch {
        // 忽略无法解析的帧
      }
    }
    let thinking = thinkingParts.join('')
    const inline = extractThinkBlocks(contentParts.join(''))
    if (inline.thinking) {
      thinking = thinking ? `${thinking}\n\n${inline.thinking}` : inline.thinking
    }
    return { thinking, content: inline.content }
  }

  try {
    const obj = JSON.parse(trimmed) as {
      choices?: Array<{
        message?: {
          content?: unknown
          reasoning_content?: unknown
          reasoning?: unknown
        }
      }>
      content?: unknown
      output_text?: unknown
    }
    const msg = obj.choices?.[0]?.message
    const contentVal = msg?.content ?? obj.content ?? obj.output_text
    let thinking =
      typeof msg?.reasoning_content === 'string' ? msg.reasoning_content : ''
    if (typeof msg?.reasoning === 'string' && !thinking) thinking = msg.reasoning
    if (typeof contentVal === 'string' && contentVal) {
      const inline = extractThinkBlocks(contentVal)
      if (inline.thinking) {
        thinking = thinking ? `${thinking}\n\n${inline.thinking}` : inline.thinking
      }
      return { thinking, content: inline.content }
    }
    if (thinking) {
      return { thinking, content: '' }
    }
    return { thinking: '', content: JSON.stringify(obj, null, 2) }
  } catch {
    return { thinking: '', content: trimmed }
  }
}

// parseRequestTurns 把存储的请求文本按"角色行 + 内容行"拆成对话轮次（CombineText 的
// OpenAI 格式：user/assistant 单独成行，后跟内容行）。首行不是角色（字符串 prompt）时
// 整段视为一段，不强行拆分，避免误判。
const REQUEST_ROLES = new Set(['user', 'assistant', 'system', 'tool', 'developer'])

type RequestTurn = { role: string; content: string[] }

function parseRequestTurns(text: string): RequestTurn[] {
  const lines = text.split('\n')
  if (lines.length === 0 || !REQUEST_ROLES.has(lines[0]?.trim() ?? '')) {
    return [{ role: '', content: [text] }]
  }
  const turns: RequestTurn[] = []
  let current: RequestTurn | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (REQUEST_ROLES.has(trimmed)) {
      current = { role: trimmed, content: [] }
      turns.push(current)
    } else if (current) {
      current.content.push(line)
    }
  }
  return turns
}

const REQUEST_ROLE_LABELS: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
  developer: 'Developer',
}

const REQUEST_ROLE_TEXT_COLOR: Record<string, string> = {
  user: 'text-primary',
  assistant: 'text-foreground',
  system: 'text-warning',
  tool: 'text-muted-foreground',
  developer: 'text-muted-foreground',
}

function requestRoleLabel(role: string): string {
  return REQUEST_ROLE_LABELS[role] ?? role
}

// serializeConversationResponse 把原始响应"序列化"成易读格式（仅展示层）：
// - SSE：逐帧把 data 里的 JSON 缩进格式化，帧间空行分隔；[DONE] 保留；
// - 非流式 JSON：整体 pretty-print；
// - 解析不了就原样返回。
function serializeConversationResponse(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return raw

  const isSSE = trimmed.startsWith('data: ') || trimmed.includes('\ndata: ')
  if (!isSSE) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return raw
    }
  }

  const frames: string[] = []
  for (const line of trimmed.split('\n')) {
    const s = line.trim()
    if (!s.startsWith('data:')) continue
    const payload = s.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      frames.push('[DONE]')
      continue
    }
    try {
      frames.push(JSON.stringify(JSON.parse(payload), null, 2))
    } catch {
      frames.push(payload)
    }
  }
  return frames.join('\n\n')
}

// ---------------------------------------------------------------------------
// 概览卡片
// ---------------------------------------------------------------------------

function OverviewCards() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['risk-control-overview'],
    queryFn: getRiskControlOverview,
  })

  const storageValue = useMemo(() => {
    if (!data) return undefined
    const used = data.conversations_used_bytes ?? 0
    return data.conversations_cap_bytes > 0
      ? `${formatBytes(used)} / ${formatBytes(data.conversations_cap_bytes)}`
      : formatBytes(used)
  }, [data])

  const items = useMemo(
    () => [
      { label: t('Low score users'), value: data?.low_score_users, key: 'low' },
      {
        label: t('Deductions today'),
        value: data?.today_deductions,
        key: 'ded',
      },
      {
        label: t('Violation events today'),
        value: data?.today_violation_events,
        key: 'viol',
      },
      {
        label: t('Conversations today'),
        value: data?.today_conversations,
        key: 'conv',
      },
      {
        label: t('Total credit logs'),
        value: data?.total_credit_logs,
        key: 'total',
      },
      {
        label: t('Conversation storage'),
        value: storageValue,
        key: 'stor',
      },
    ],
    [data, storageValue, t]
  )

  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6'>
      {items.map((item) => (
        <Card key={item.key}>
          <CardHeader className='pb-1'>
            <CardDescription className='text-xs'>{item.label}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className='h-7 w-14' />
            ) : (
              <div className='text-2xl font-semibold'>{item.value ?? '-'}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 低分用户
// ---------------------------------------------------------------------------

function LowScoreUsersTab() {
  const { t } = useTranslation()
  const [adjust, setAdjust] = useState<User | null>(null)

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
    globalFilter: { enabled: true, key: 'threshold' },
    columnFilters: [],
  })

  const thresholdNum = globalFilter?.trim()
    ? Number(globalFilter.trim())
    : undefined

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['risk-control-low-users', pagination.pageIndex, thresholdNum],
    queryFn: () =>
      getLowScoreUsers({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        threshold:
          thresholdNum && Number.isFinite(thresholdNum) && thresholdNum > 0
            ? thresholdNum
            : undefined,
      }),
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) => (
          <span className='font-medium'>
            {row.original.username}
            {row.original.display_name ? ` (${row.original.display_name})` : ''}
          </span>
        ),
      },
      {
        accessorKey: 'credit_score',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Credit Score')} />
        ),
        cell: ({ row }) => (
          <Badge
            variant={
              (row.original.credit_score ?? 650) < 500
                ? 'destructive'
                : 'warning'
            }
          >
            {row.original.credit_score ?? '-'}
          </Badge>
        ),
      },
      { accessorKey: 'group', header: t('Group') },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) =>
          row.original.status === 1 ? t('Enabled') : t('Disabled'),
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={t('Adjust')}
                  onClick={() => setAdjust(row.original)}
                  className='text-muted-foreground hover:text-foreground size-8'
                />
              }
            >
              <SlidersHorizontal />
            </TooltipTrigger>
            <TooltipContent>{t('Adjust')}</TooltipContent>
          </Tooltip>
        ),
      },
    ],
    [t]
  )

  const table = useDataTable({
    data: data?.items ?? [],
    columns,
    totalCount: data?.total ?? 0,
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
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No low-score users')}
        emptyDescription={t('No users below the threshold.')}
        skeletonKeyPrefix='risk-low-users'
        toolbarProps={{
          searchPlaceholder: t('Max score shown (default 500)'),
          searchDebounceMs: 500,
        }}
      />
      <AdjustDialog
        user={adjust}
        onClose={() => setAdjust(null)}
        onSaved={() => void refetch()}
      />
    </>
  )
}

function AdjustDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: adjustCreditScore,
    onSuccess: () => {
      toast.success(t('Adjusted'))
      onSaved()
      onClose()
      // 精确失效实际使用的 key：TanStack Query 前缀匹配按数组元素精确比较，
      // ['risk-control'] 匹配不到 ['risk-control-overview'] 等。
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-overview'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-low-users'],
      })
    },
    onError: () => toast.error(t('Adjust failed')),
  })

  const pointsNum = Number(points)
  const pointsInvalid = points === '' || Number.isNaN(pointsNum)

  return (
    <Dialog open={user != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('Adjust credit score')} — {user?.username ?? ''} (now{' '}
            {user?.credit_score ?? 0})
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div>
            <label className='text-sm'>{t('Points')}</label>
            <Input
              type='number'
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder='-10 / 15'
            />
          </div>
          <div>
            <label className='text-sm'>{t('Reason')}</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={mutation.isPending || pointsInvalid}
            onClick={() =>
              user &&
              mutation.mutate({
                user_id: user.id,
                points: pointsNum,
                reason,
              })
            }
          >
            <Save data-icon='inline-start' />
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 扣分明细
// ---------------------------------------------------------------------------

const CREDIT_LOG_SOURCE_OPTIONS = [
  { label: 'All sources', value: 'all' },
  { label: 'Upstream violation', value: 'upstream_violation' },
  { label: 'Sensitive-word hit', value: 'local_keyword' },
  { label: 'Passive recovery', value: 'passive_recover' },
  { label: 'Pledge', value: 'pledge' },
  { label: 'Admin adjust', value: 'admin_adjust' },
]

function CreditLogsTab() {
  const { t } = useTranslation()

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'user_id' },
    columnFilters: [{ columnId: 'source', searchKey: 'source', type: 'array' }],
  })

  const sourceFilter =
    (columnFilters.find((f) => f.id === 'source')?.value as string[]) ?? []
  const uid = globalFilter?.trim() ? Number(globalFilter.trim()) : undefined

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'risk-control-credit-logs',
      pagination.pageIndex,
      uid,
      sourceFilter,
    ],
    queryFn: () =>
      getCreditScoreLogs({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        user_id:
          uid && Number.isFinite(uid) && uid > 0 ? uid : undefined,
        source:
          sourceFilter.length > 0 && !sourceFilter.includes('all')
            ? sourceFilter[0]
            : undefined,
      }),
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo<ColumnDef<CreditScoreLog>[]>(
    () => [
      { accessorKey: 'id', header: 'ID' },
      { accessorKey: 'user_id', header: t('User') },
      {
        accessorKey: 'source',
        header: t('Source'),
        cell: ({ row }) => (
          <Badge variant='outline'>{row.original.source}</Badge>
        ),
      },
      {
        accessorKey: 'points',
        header: t('Points'),
        cell: ({ row }) => (
          <Badge variant={row.original.points < 0 ? 'destructive' : 'outline'}>
            {row.original.points}
          </Badge>
        ),
      },
      { accessorKey: 'balance', header: t('Balance') },
      {
        accessorKey: 'reason',
        header: t('Reason'),
        cell: ({ row }) => (
          <span
            className='line-clamp-1 max-w-[320px]'
            title={row.original.reason}
          >
            {row.original.reason}
          </span>
        ),
      },
      {
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) => formatTs(row.original.created_at),
      },
    ],
    [t]
  )

  const table = useDataTable({
    data: data?.items ?? [],
    columns,
    totalCount: data?.total ?? 0,
    columnFilters,
    globalFilter,
    globalFilterFn: () => true,
    pagination,
    onColumnFiltersChange,
    onGlobalFilterChange,
    onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    ensurePageInRange,
  })

  return (
    <DataTablePage
      table={table.table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No records')}
      emptyDescription={t('No credit score events yet.')}
      skeletonKeyPrefix='risk-credit-logs'
      toolbarProps={{
        searchPlaceholder: t('Filter by user ID...'),
        searchDebounceMs: 500,
        onReset: () => {
          // URL 为单一数据源：显式清掉 source/user_id 查询参数，避免服务端筛选
          // 下工具栏重置按钮只清表内状态、URL 残留导致"重置了但筛选还在"。
          onColumnFiltersChange([])
          onGlobalFilterChange?.('')
        },
        filters: [
          {
            columnId: 'source',
            title: t('Source'),
            options: CREDIT_LOG_SOURCE_OPTIONS,
            singleSelect: true,
          },
        ],
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// 对话记录
// ---------------------------------------------------------------------------

function ConversationsTab() {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<ConversationRecord | null>(null)

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'request_id' },
    columnFilters: [
      { columnId: '_modelSearch', searchKey: 'model_name', type: 'string' },
      { columnId: '_userSearch', searchKey: 'user_id', type: 'string' },
    ],
  })

  const {
    value: modelFilter,
    inputValue: modelFilterInput,
    setInputValue: setModelFilterInput,
  } = useDebouncedColumnFilter({
    columnFilters,
    columnId: '_modelSearch',
    onColumnFiltersChange,
  })
  const {
    value: userIdFilter,
    inputValue: userIdFilterInput,
    setInputValue: setUserIdFilterInput,
  } = useDebouncedColumnFilter({
    columnFilters,
    columnId: '_userSearch',
    onColumnFiltersChange,
  })

  const uid = userIdFilter.trim() ? Number(userIdFilter.trim()) : undefined

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'risk-control-conversations',
      pagination.pageIndex,
      globalFilter,
      modelFilter,
      userIdFilter,
    ],
    queryFn: () =>
      getConversationRecords({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        request_id: globalFilter || undefined,
        model_name: modelFilter || undefined,
        user_id:
          uid && Number.isFinite(uid) && uid > 0 ? uid : undefined,
      }),
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo<ColumnDef<ConversationRecord>[]>(
    () => [
      { accessorKey: 'id', header: 'ID' },
      { accessorKey: 'user_id', header: t('User') },
      { accessorKey: 'model_name', header: t('Model') },
      {
        accessorKey: 'status_code',
        header: t('Status'),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status_code >= 400 ? 'destructive' : 'outline'
            }
          >
            {row.original.status_code}
          </Badge>
        ),
      },
      {
        accessorKey: 'request_id',
        header: t('Request ID'),
        cell: ({ row }) => (
          <span
            className='line-clamp-1 max-w-[180px]'
            title={row.original.request_id}
          >
            {row.original.request_id}
          </span>
        ),
      },
      {
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) => formatTs(row.original.created_at),
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={t('View')}
                  onClick={() => setDetail(row.original)}
                  className='text-muted-foreground hover:text-foreground size-8'
                />
              }
            >
              <Eye />
            </TooltipTrigger>
            <TooltipContent>{t('View')}</TooltipContent>
          </Tooltip>
        ),
      },
    ],
    [t]
  )

  const table = useDataTable({
    data: data?.items ?? [],
    columns,
    totalCount: data?.total ?? 0,
    columnFilters,
    globalFilter,
    globalFilterFn: () => true,
    pagination,
    onColumnFiltersChange,
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
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No conversation records')}
        emptyDescription={t('Conversation retention is disabled or empty.')}
        skeletonKeyPrefix='risk-conversations'
        toolbarProps={{
          searchPlaceholder: t('Filter by request ID...'),
          searchDebounceMs: 500,
          onReset: () => {
            setModelFilterInput('')
            setUserIdFilterInput('')
          },
          additionalSearch: (
            <>
              <Input
                placeholder={t('Filter by model...')}
                value={modelFilterInput}
                onChange={(e) => setModelFilterInput(e.target.value)}
                className='w-full sm:w-40 lg:w-48'
              />
              <Input
                placeholder={t('Filter by user ID...')}
                value={userIdFilterInput}
                onChange={(e) => setUserIdFilterInput(e.target.value)}
                className='w-full sm:w-32 lg:w-40'
              />
            </>
          ),
        }}
      />
      <ConversationDetailDialog
        record={detail}
        onClose={() => setDetail(null)}
      />
    </>
  )
}

function ConversationDetailDialog({
  record,
  onClose,
}: {
  record: ConversationRecord | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [showRawResponse, setShowRawResponse] = useState(false)
  // 列表接口不投影正文，打开详情时按 id 单独拉全文。
  const { data: detail, isFetching } = useQuery({
    queryKey: ['risk-control-conversation-detail', record?.id],
    // enabled 保证 record 非空时才执行，闭包里用可选链兜底即可（不引非空断言）。
    queryFn: () => getConversationRecord(record?.id ?? 0),
    enabled: record != null,
  })
  const request = detail?.request
  const response = detail?.response
  const isSSE = Boolean(response && /data: /.test(response))
  const parsed = useMemo(
    () =>
      response
        ? parseConversationResponse(response)
        : { thinking: '', content: '' },
    [response]
  )
  const requestTurns = useMemo(
    () => (request ? parseRequestTurns(request) : []),
    [request]
  )

  return (
    <Dialog open={record != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-2xl lg:max-w-3xl max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            {t('Conversation')} #{record?.id ?? ''} · {record?.model_name ?? ''}
          </DialogTitle>
        </DialogHeader>
        {isFetching || !detail ? (
          <div className='space-y-3 text-xs'>
            <Skeleton className='h-24 w-full' />
            <Skeleton className='h-40 w-full' />
          </div>
        ) : (
          <div className='space-y-3 text-xs'>
            <div className='min-w-0'>
              <div className='mb-1 font-medium'>{t('Request')}</div>
              {request && requestTurns[0]?.role !== '' ? (
                <div className='space-y-1.5'>
                  {requestTurns.map((turn) => (
                    <div
                      key={turn.content.join('\n') || `${turn.role}-empty`}
                      className='rounded-md border p-2'
                    >
                      <span
                        className={`text-[11px] font-medium uppercase tracking-wide ${REQUEST_ROLE_TEXT_COLOR[turn.role] ?? 'text-muted-foreground'}`}
                      >
                        {t(requestRoleLabel(turn.role))}
                      </span>
                      <pre className='mt-1 max-h-40 overflow-auto break-all whitespace-pre-wrap'>
                        {turn.content.join('\n') || t('Empty')}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className='bg-muted max-h-60 overflow-auto rounded-md p-2 break-all whitespace-pre-wrap'>
                  {request || t('Empty')}
                </pre>
              )}
            </div>
            <div className='min-w-0'>
              <div className='mb-1 flex items-center justify-between gap-2'>
                <div className='font-medium'>{t('Response')}</div>
                {isSSE && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-6 px-2 text-xs'
                    onClick={() => setShowRawResponse((v) => !v)}
                  >
                    {showRawResponse ? t('Show parsed') : t('Show raw')}
                  </Button>
                )}
              </div>
              {!showRawResponse && response ? (
                <div className='space-y-2'>
                  {parsed.thinking && (
                    <div className='bg-muted/50 rounded-md border border-dashed p-2'>
                      <div className='text-muted-foreground mb-1 flex items-center gap-1 font-medium'>
                        <Brain className='size-3.5' aria-hidden='true' />
                        {t('Thinking')}
                      </div>
                      <pre className='text-muted-foreground max-h-40 overflow-auto break-all whitespace-pre-wrap'>
                        {parsed.thinking}
                      </pre>
                    </div>
                  )}
                  <pre className='bg-muted max-h-60 overflow-auto rounded-md p-2 break-all whitespace-pre-wrap'>
                    {parsed.content || t('Empty')}
                  </pre>
                </div>
              ) : (
                <pre className='bg-muted max-h-60 overflow-auto rounded-md p-2 break-all whitespace-pre-wrap'>
                  {response
                    ? serializeConversationResponse(response)
                    : t('Empty')}
                </pre>
              )}
              {isSSE && !showRawResponse && (
                <p className='text-muted-foreground mt-1 text-[11px] leading-relaxed'>
                  {t(
                    'SSE parsed: delta.content is the reply delta (joined); delta.reasoning_content is the thinking delta; usage.* is token stats; [DONE] ends the stream.'
                  )}
                </p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 标记词
// ---------------------------------------------------------------------------

function MarkersTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [markersText, setMarkersText] = useState<string | null>(null)

  const { data: markerData } = useQuery({
    queryKey: ['risk-control-markers'],
    queryFn: getMarkers,
  })
  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['risk-control-suggestions'],
    queryFn: () =>
      getMarkerSuggestions({ p: 1, page_size: 20, status: 'pending' }),
  })

  const saveMarkersMutation = useMutation({
    mutationFn: updateMarkers,
    onSuccess: () => {
      toast.success(t('Saved'))
      void queryClient.invalidateQueries({ queryKey: ['risk-control-markers'] })
    },
    onError: () => toast.error(t('Save failed')),
  })
  const analyzeMutation = useMutation({
    mutationFn: analyzeMarkers,
    onSuccess: (r) => {
      toast.success(
        `${t('Analysis done')}: ${t('analyzed')} ${r.analyzed}, ${t('suggestions')} ${r.suggestions}`
      )
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-suggestions'],
      })
    },
    onError: () => toast.error(t('Analysis failed')),
  })
  const acceptMutation = useMutation({
    mutationFn: acceptMarkerSuggestion,
    onSuccess: () => {
      toast.success(t('Accepted'))
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-suggestions'],
      })
      void queryClient.invalidateQueries({ queryKey: ['risk-control-markers'] })
    },
  })
  const rejectMutation = useMutation({
    mutationFn: rejectMarkerSuggestion,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-suggestions'],
      })
    },
  })

  const currentText = markersText ?? markerData?.markers?.join('\n') ?? ''

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Current violation markers')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={currentText}
            onChange={(e) => setMarkersText(e.target.value)}
            rows={6}
            placeholder='is sensitive&#10;please check your input'
          />
          <div className='mt-2 flex items-center justify-end gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setMarkersText(null)}
            >
              {t('Reset')}
            </Button>
            <Button
              size='sm'
              disabled={saveMarkersMutation.isPending || markersText == null}
              onClick={() =>
                saveMarkersMutation.mutate(
                  currentText
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
            >
              <Save data-icon='inline-start' />
              {t('Save markers')}
            </Button>
            <Button
              size='sm'
              variant='secondary'
              disabled={analyzeMutation.isPending}
              onClick={() => analyzeMutation.mutate()}
            >
              <Sparkles className='size-4' aria-hidden='true' />
              {t('Analyze logs for new markers')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('AI suggestions (pending)')}</CardTitle>
        </CardHeader>
        <CardContent>
          {renderSuggestions(
            isLoading,
            suggestions?.items,
            t,
            acceptMutation,
            rejectMutation
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function renderSuggestions(
  isLoading: boolean,
  items: MarkerSuggestion[] | undefined,
  t: (key: string) => string,
  accept: { mutate: (id: number) => void },
  reject: { mutate: (id: number) => void }
): ReactNode {
  if (isLoading) {
    return <Skeleton className='h-10 w-full' />
  }
  if (!items?.length) {
    return (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        {t('No pending suggestions')}
      </p>
    )
  }
  return (
    <div className='space-y-2'>
      {items.map((s) => (
        <div
          key={s.id}
          className='flex flex-wrap items-start justify-between gap-2 rounded-md border p-3'
        >
          <div className='min-w-0 flex-1'>
            <code className='bg-muted rounded px-1'>{s.marker}</code>
            <div className='text-muted-foreground mt-1 line-clamp-2 text-xs'>
              {s.example}
            </div>
          </div>
          <div className='flex shrink-0 gap-1'>
            <Button size='sm' onClick={() => accept.mutate(s.id)}>
              {t('Accept')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => reject.mutate(s.id)}
            >
              {t('Reject')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type RiskControlTab = 'users' | 'logs' | 'conversations' | 'markers'

export function RiskControlPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = route.useSearch()
  const activeTab: RiskControlTab = search.tab ?? 'users'

  const handleTabChange = (value: string) => {
    void navigate({
      to: '/risk-control',
      search: { tab: value as RiskControlTab },
    })
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <ShieldAlert className='size-4' aria-hidden='true' />
          <span className='truncate'>{t('Risk Control')}</span>
          <Badge variant='outline' className='shrink-0'>
            Root
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <OverviewCards />
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value='users'>{t('Low Score Users')}</TabsTrigger>
              <TabsTrigger value='logs'>{t('Credit Logs')}</TabsTrigger>
              <TabsTrigger value='conversations'>
                {t('Conversations')}
              </TabsTrigger>
              <TabsTrigger value='markers'>{t('Markers')}</TabsTrigger>
            </TabsList>
            <TabsContent value='users'>
              <LowScoreUsersTab />
            </TabsContent>
            <TabsContent value='logs'>
              <CreditLogsTab />
            </TabsContent>
            <TabsContent value='conversations'>
              <ConversationsTab />
            </TabsContent>
            <TabsContent value='markers'>
              <MarkersTab />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
