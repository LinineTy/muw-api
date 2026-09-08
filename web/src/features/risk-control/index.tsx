// @muw-owned
/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table'
import { VChart } from '@visactor/react-vchart'
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  Eye,
  Hash,
  ListChecks,
  ListFilter,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTableBulkActions,
  DataTableColumnHeader,
  DataTablePage,
  useDebouncedColumnFilter,
  useDataTable,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog as SettingsDialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
import { Checkbox } from '@/components/ui/checkbox'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Markdown } from '@/components/ui/markdown'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MobileToggleMenu, ToggleMenuItem, TogglePill } from '@/components/ui/responsive-toggle'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTheme } from '@/context/theme-provider'
import { getDashboardChartColors } from '@/features/dashboard/lib/charts'
import type { User } from '@/features/users/types'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { VCHART_OPTION } from '@/lib/vchart'

import {
  acceptMarkerSuggestion,
  adjustCreditScore,
  analyzeMarkers,
  getConversationRecord,
  getConversationRecords,
  getCreditScoreLogs,
  getKeywordHitStats,
  getLowScoreUsers,
  getMarkerAnalysisErrorStats,
  getMarkerAnalysisLogs,
  getMarkerAnalysisStatus,
  getMarkerSuggestions,
  getMarkers,
  getRiskControlOverview,
  getUserHitStats,
  rejectMarkerSuggestion,
  resetMarkers,
  revertKeywordDeduction,
  revertKeywordDeductions,
  revertKeywordHits,
  updateMarkers,
} from './api'
import type {
  ConversationRecord,
  CreditScoreLog,
  MarkerSuggestion,
} from './types'

const route = getRouteApi('/_authenticated/risk-control/')

// 从敏感词扣分原因里解析命中的词。后端 reason 格式："敏感词命中: 词A, 词B"。
function parseSensitiveWordsFromReason(reason: string): string[] {
  const m = reason.match(/敏感词命中:\s*(.+)/)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

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

// 分析历史触发方式的徽标配色（manual 走默认 outline）。
const TRIGGER_BADGE_VARIANT: Record<
  string,
  'secondary' | 'warning' | 'outline' | 'destructive'
> = {
  threshold: 'warning',
  force: 'destructive',
}

function analysisTriggerLabel(
  triggeredBy: string,
  t: (key: string) => string
): string {
  if (triggeredBy === 'threshold') return t('Threshold')
  if (triggeredBy === 'force') return t('Full re-run')
  return t('Manual')
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

// ToolCallData 一次会话中出现的工具调用（SSE 流里 name/arguments 分片累积合并）。
// id 来自上游 tool_calls 的 call_xxx（SSE 首帧带、后续分片帧只带 index）。
type ToolCallData = { id: string; name: string; arguments: string }

// UsageStats 流式/非流式响应里携带的 token 统计（OpenAI 兼容 usage 字段；
// Anthropic 格式为 input_tokens/output_tokens）。
type UsageStats = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

// parseConversationResponse 把存储的原始响应解析成可读文本（仅展示层，不改存储）：
// 返回 { thinking, content, toolCalls, usage }，思考（reasoning_content 或内联 <think> 块）
// 与回复内容分开，工具调用（delta.tool_calls / message.tool_calls）单独归集，token 统计保留。
// - SSE 流：逐行取 data 帧的 choices[0].delta.content（回复）、delta.reasoning_content（思考）
//   与 delta.tool_calls（工具调用，name/arguments 按 index 分片累积），并收集末尾 usage 帧；
// - 非流式 JSON：取 choices[0].message.content / reasoning_content / tool_calls 与 usage；
// - 解析不了就原样放进 content。
function parseConversationResponse(raw: string): {
  thinking: string
  content: string
  toolCalls: ToolCallData[]
  usage?: UsageStats
} {
  // 某些转换渠道把 SSE 帧间换行写成了字面 "\n"（backslash-n），前端按真实换行拆帧会
  // 把整个响应当一行而解析失败。只把帧间分隔 "\n\ndata:" 还原为真实换行；帧内 JSON
  // 转义的字面 "\n" 保持不动（那是合法 JSON 转义，拆帧后由 JSON.parse 还原）。
  const normalized = raw.replace(/\\n\\ndata:/g, '\n\ndata:')
  const trimmed = normalized.trim()
  if (!trimmed) return { thinking: '', content: '', toolCalls: [] }

  const isSSE = trimmed.startsWith('data: ') || trimmed.includes('\ndata: ')
  if (isSSE) {
    const thinkingParts: string[] = []
    const contentParts: string[] = []
    // tool_calls 流式分片：按 index 累积 name（只出现在首帧）与 arguments（分片拼接）。
    const toolCallsMap: Record<number, ToolCallData> = {}
    let usage: UsageStats | undefined
    for (const line of trimmed.split('\n')) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const payload = s.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const obj = JSON.parse(payload) as {
          type?: string
          choices?: Array<{
            delta?: {
              content?: unknown
              reasoning_content?: unknown
              tool_calls?: Array<{
                index?: number
                id?: string
                function?: { name?: unknown; arguments?: unknown }
              }>
            }
          }>
          delta?: { text?: unknown; thinking?: unknown }
          content_block?: { type?: string; thinking?: unknown }
          usage?: UsageStats
        }
        const delta = obj.choices?.[0]?.delta
        if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
          thinkingParts.push(delta.reasoning_content)
        }
        if (typeof delta?.content === 'string' && delta.content) {
          contentParts.push(delta.content)
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            const cur = toolCallsMap[idx] ?? { id: '', name: '', arguments: '' }
            if (typeof tc.id === 'string' && tc.id) {
              cur.id = tc.id
            }
            if (typeof tc.function?.name === 'string') {
              cur.name += tc.function.name
            }
            if (typeof tc.function?.arguments === 'string') {
              cur.arguments += tc.function.arguments
            }
            toolCallsMap[idx] = cur
          }
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
        if (obj.usage && typeof obj.usage === 'object') {
          usage = { ...usage, ...obj.usage }
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
    return {
      thinking,
      content: inline.content,
      toolCalls: Object.values(toolCallsMap),
      usage,
    }
  }

  try {
    const obj = JSON.parse(trimmed) as {
      choices?: Array<{
        message?: {
          content?: unknown
          reasoning_content?: unknown
          reasoning?: unknown
          tool_calls?: Array<{
            id?: string
            function?: { name?: unknown; arguments?: unknown }
          }>
        }
      }>
      content?: unknown
      output_text?: unknown
      usage?: UsageStats
    }
    const msg = obj.choices?.[0]?.message
    const contentVal = msg?.content ?? obj.content ?? obj.output_text
    let thinking =
      typeof msg?.reasoning_content === 'string' ? msg.reasoning_content : ''
    if (typeof msg?.reasoning === 'string' && !thinking) thinking = msg.reasoning
    const usage =
      obj.usage && typeof obj.usage === 'object'
        ? (obj.usage as UsageStats)
        : undefined
    const toolCalls: ToolCallData[] = Array.isArray(msg?.tool_calls)
      ? msg.tool_calls.map((tc) => ({
          id: typeof tc.id === 'string' ? tc.id : '',
          name: typeof tc.function?.name === 'string' ? tc.function.name : '',
          arguments:
            typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : '',
        }))
      : []
    if (typeof contentVal === 'string' && contentVal) {
      const inline = extractThinkBlocks(contentVal)
      if (inline.thinking) {
        thinking = thinking ? `${thinking}\n\n${inline.thinking}` : inline.thinking
      }
      return { thinking, content: inline.content, toolCalls, usage }
    }
    if (thinking) {
      return { thinking, content: '', toolCalls, usage }
    }
    if (toolCalls.length > 0) {
      return { thinking: '', content: '', toolCalls, usage }
    }
    return {
      thinking: '',
      content: JSON.stringify(obj, null, 2),
      toolCalls: [],
      usage,
    }
  } catch {
    return { thinking: '', content: trimmed, toolCalls: [] }
  }
}

// parseRequestTurns 把存储的请求文本按"角色行 + 内容行"拆成对话轮次（CombineText 的
// OpenAI 格式：user/assistant 单独成行，后跟内容行）。首行不是角色（字符串 prompt）时
// 整段视为一段，不强行拆分，避免误判。
const REQUEST_ROLES = new Set(['user', 'assistant', 'system', 'tool', 'developer'])

type RequestTurn = { role: string; content: string[] }

function parseRequestTurns(text: string): RequestTurn[] {
  // 转换渠道可能把请求文本的换行转义成字面 "\n"（backslash-n），不还原就拆不出角色行。
  // 与 response 的帧间分隔不同，request 是纯文本，字面 "\n" 全部还原为真实换行。
  const normalized = text.replace(/\\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length === 0 || !REQUEST_ROLES.has(lines[0]?.trim() ?? '')) {
    return [{ role: '', content: [normalized] }]
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
  const normalized = raw.replace(/\\n\\ndata:/g, '\n\ndata:')
  const trimmed = normalized.trim()
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

  // 读配置的冻结阈值作为默认展示：空筛选时低分列表按它筛（后端同样默认 freeze_threshold），
  // 占位符显示配置值而不是写死 500，改配置后这里自动跟着变。
  const { data: overviewData } = useQuery({
    queryKey: ['risk-control-overview'],
    queryFn: getRiskControlOverview,
  })
  const freezeThreshold = overviewData?.freeze_threshold

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
      { accessorKey: 'id', header: 'ID' },
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
          searchPlaceholder: t('Max score shown (default {{threshold}})', {
            threshold: freezeThreshold ?? 500,
          }),
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
  { label: 'Admin revert', value: 'admin_revert' },
  { label: 'Full score reset', value: 'full_score_reset' },
]

// source 标识 → i18n key（扣分明细"来源"列展示用，中文界面显示中文，未命中回退原始标识）。
const CREDIT_LOG_SOURCE_LABELS: Record<string, string> = {
  upstream_violation: 'Upstream violation',
  local_keyword: 'Sensitive-word hit',
  passive_recover: 'Passive recovery',
  pledge: 'Pledge',
  admin_adjust: 'Admin adjust',
  admin_revert: 'Admin revert',
  full_score_reset: 'Full score reset',
}

// 是否可以打回一条扣分记录：本地敏感词扣分、负分、未打回。
function canRevertCreditLog(log: CreditScoreLog): boolean {
  return log.source === 'local_keyword' && log.points < 0 && !log.reverted_at
}

function CreditLogsTab({ batchMode }: { batchMode: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [revertTarget, setRevertTarget] = useState<CreditScoreLog | null>(null)
  const [conversationTarget, setConversationTarget] =
    useState<ConversationRecord | null>(null)
  const [batchRevertOpen, setBatchRevertOpen] = useState(false)
  const [keywordRevertOpen, setKeywordRevertOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [keywordRemove, setKeywordRemove] = useState(true)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
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

  // 翻页/筛选变化时清空选中：手动分页下旧页选中行不在当前数据里，留着会被
  // getFilteredSelectedRowModel 静默忽略，造成"选了几条只打回几条"。
  // sourceFilter 每次渲染都是新数组，用 join 出的稳定字符串做依赖。
  const sourceFilterKey = sourceFilter.join(',')
  useEffect(() => {
    setRowSelection({})
  }, [pagination.pageIndex, pagination.pageSize, sourceFilterKey, uid])
  // 关闭批量模式时清空选中，避免再次打开时残留旧选中。
  useEffect(() => {
    if (!batchMode) setRowSelection({})
  }, [batchMode])

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

  const invalidateCreditLogs = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['risk-control-credit-logs'],
    })
    void queryClient.invalidateQueries({ queryKey: ['risk-control-overview'] })
    void queryClient.invalidateQueries({
      queryKey: ['risk-control-keyword-stats'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['risk-control-user-hit-stats'],
    })
    // 打回会删敏感词，同步失效设置页的词库缓存，避免设置页仍显示已删的词。
    void queryClient.invalidateQueries({ queryKey: ['system-options'] })
  }, [queryClient])

  const batchRevertMutation = useMutation({
    mutationFn: (logIds: number[]) =>
      revertKeywordDeductions({ log_ids: logIds }),
    onSuccess: (r) => {
      toast.success(
        t(
          'Batch reverted: {{users}} users affected, {{points}} points restored.',
          { users: r.users, points: r.points }
        )
      )
      setBatchRevertOpen(false)
      setRowSelection({})
      invalidateCreditLogs()
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Revert failed'))
    },
  })

  const keywordRevertMutation = useMutation({
    mutationFn: () =>
      revertKeywordHits({ keyword, remove_from_library: keywordRemove }),
    onSuccess: (r) => {
      toast.success(
        t(
          'Reverted {{count}} deductions hitting the keyword ({{users}} users, {{points}} points restored).',
          { count: r.count, users: r.users, points: r.points }
        )
      )
      setKeywordRevertOpen(false)
      setKeyword('')
      invalidateCreditLogs()
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Revert failed'))
    },
  })

  // 按 request_id 找到关联的对话记录并打开详情弹窗（证据链：扣分 → 对话原文）。
  const handleViewConversation = useCallback(async (requestId: string) => {
    try {
      const res = await getConversationRecords({
        request_id: requestId,
        p: 1,
        page_size: 1,
      })
      const found = res.items[0]
      if (found) {
        setConversationTarget(found)
      } else {
        toast.info(t('No conversation record found for this request.'))
      }
    } catch {
      toast.error(t('Failed to look up the conversation record'))
    }
  }, [t])

  const handleBatchRevert = () => {
    const ids = table.table
      .getFilteredSelectedRowModel()
      .rows.map((r) => r.original)
      .filter(canRevertCreditLog)
      .map((l) => l.id)
    if (ids.length === 0) {
      toast.info(t('No revertable logs selected'))
      return
    }
    batchRevertMutation.mutate(ids)
  }

  const columns = useMemo<ColumnDef<CreditScoreLog>[]>(
    () => [
      ...(batchMode
        ? [
            {
              id: 'select',
              header: ({ table }) => (
                <Checkbox
                  checked={table.getIsAllPageRowsSelected()}
                  indeterminate={table.getIsSomePageRowsSelected()}
                  onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                  aria-label={t('Select all')}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                  aria-label={t('Select row')}
                />
              ),
              enableSorting: false,
              enableHiding: false,
              size: 40,
            } satisfies ColumnDef<CreditScoreLog>,
          ]
        : []),
      { accessorKey: 'id', header: 'ID' },
      {
        accessorKey: 'user_id',
        header: t('User'),
        cell: ({ row }) => (
          <span className='font-medium'>
            #{row.original.user_id}
            {row.original.username ? ` ${row.original.username}` : ''}
          </span>
        ),
      },
      {
        accessorKey: 'source',
        header: t('Source'),
        cell: ({ row }) => (
          <Badge variant='outline'>
            {t(
              CREDIT_LOG_SOURCE_LABELS[row.original.source] ??
                row.original.source
            )}
          </Badge>
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
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => {
          const log = row.original
          return (
            <div className='flex items-center gap-1'>
              {canRevertCreditLog(log) && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={t('Revert')}
                        onClick={() => setRevertTarget(log)}
                        className='text-muted-foreground hover:text-foreground size-8'
                      />
                    }
                  >
                    <RotateCcw />
                  </TooltipTrigger>
                  <TooltipContent>{t('Revert')}</TooltipContent>
                </Tooltip>
              )}
              {log.request_id && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={t('View conversation')}
                        onClick={() => void handleViewConversation(log.request_id)}
                        className='text-muted-foreground hover:text-foreground size-8'
                      />
                    }
                  >
                    <Eye />
                  </TooltipTrigger>
                  <TooltipContent>{t('View conversation')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          )
        },
      },
    ],
    [t, handleViewConversation, batchMode]
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
    enableRowSelection: batchMode,
    getRowId: (row) => String(row.id),
    rowSelection,
    onRowSelectionChange: setRowSelection,
  })

  return (
    <>
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
        preActions: (
          <Button
            variant='outline'
            size='sm'
            onClick={() => setKeywordRevertOpen(true)}
          >
            <ListFilter className='size-4' aria-hidden='true' />
            {t('Revert by keyword')}
          </Button>
        ),
        filters: [
          {
            columnId: 'source',
            title: t('Source'),
            // 每次渲染新建数组(而非模块常量):DataTableFacetedFilter 被 React.memo
            // 缓存、浅比较 props,options 引用变化才能让 memo 失效、勾选状态随
            // columnFilters 刷新(与 channels 页 [...CHANNEL_STATUS_OPTIONS] 一致)。
            options: [...CREDIT_LOG_SOURCE_OPTIONS],
            singleSelect: true,
          },
        ],
      }}
      bulkActions={
        batchMode ? (
          <DataTableBulkActions table={table.table} entityName='credit log'>
            <Button
              variant='destructive'
              size='sm'
              disabled={batchRevertMutation.isPending}
              onClick={() => setBatchRevertOpen(true)}
            >
              <RotateCcw className='size-4' aria-hidden='true' />
              {t('Revert selected')}
            </Button>
          </DataTableBulkActions>
        ) : null
      }
    />
    <RevertKeywordDialog
      log={revertTarget}
      onClose={() => setRevertTarget(null)}
    />
    <ConversationDetailDialog
      record={conversationTarget}
      onClose={() => setConversationTarget(null)}
    />
    <ConfirmDialog
      open={batchRevertOpen}
      onOpenChange={setBatchRevertOpen}
      title={t('Revert selected deductions?')}
      desc={t(
        'Restores points for the selected sensitive-word deductions and removes the hit words from the sensitive-word library. Each affected user gets a single aggregated revert record.'
      )}
      destructive
      confirmText={t('Revert selected')}
      isLoading={batchRevertMutation.isPending}
      handleConfirm={() => {
        setBatchRevertOpen(false)
        handleBatchRevert()
      }}
    />
    <KeywordRevertDialog
      open={keywordRevertOpen}
      onOpenChange={setKeywordRevertOpen}
      keyword={keyword}
      onKeywordChange={setKeyword}
      removeFromLibrary={keywordRemove}
      onRemoveFromLibraryChange={setKeywordRemove}
      isPending={keywordRevertMutation.isPending}
      onConfirm={() => {
        setKeywordRevertOpen(false)
        keywordRevertMutation.mutate()
      }}
    />
    </>
  )
}

// 按关键词一键打回弹窗：输入关键词，可选同时从敏感词库删除该词。
function KeywordRevertDialog({
  open,
  onOpenChange,
  keyword,
  onKeywordChange,
  removeFromLibrary,
  onRemoveFromLibraryChange,
  isPending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyword: string
  onKeywordChange: (value: string) => void
  removeFromLibrary: boolean
  onRemoveFromLibraryChange: (value: boolean) => void
  isPending: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const trimmed = keyword.trim()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('Revert by keyword')}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3 text-sm'>
          <p className='text-muted-foreground'>
            {t(
              'Reverts every non-reverted sensitive-word deduction that hit this keyword, aggregated per user. Useful after a word turns out to be a false positive.'
            )}
          </p>
          <div>
            <label className='text-sm'>{t('Keyword')}</label>
            <Input
              value={keyword}
              onChange={(e) => onKeywordChange(e.target.value)}
              placeholder='keyword'
            />
          </div>
          <label className='flex cursor-pointer items-center gap-2'>
            <Checkbox
              checked={removeFromLibrary}
              onCheckedChange={(value) => onRemoveFromLibraryChange(!!value)}
            />
            <span>
              {t('Also remove this keyword from the sensitive-word library')}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('Cancel')}
          </Button>
          <Button disabled={isPending || !trimmed} onClick={onConfirm}>
            <RotateCcw className='size-4' aria-hidden='true' />
            {removeFromLibrary
              ? t('Revert & remove keyword')
              : t('Revert all hits')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 敏感词扣分打回
// ---------------------------------------------------------------------------

// 管理端审核认为敏感词扣分属误判时打回：恢复扣掉的分，可选从敏感词库删除命中的词。
function RevertKeywordDialog({
  log,
  onClose,
}: {
  log: CreditScoreLog | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const hitWords = useMemo(
    () => (log ? parseSensitiveWordsFromReason(log.reason) : []),
    [log]
  )
  // 勾选状态初始全选；log 变化（打开/切换目标）时重置。
  const [checkedWords, setCheckedWords] = useState<string[]>(hitWords)
  useEffect(() => {
    setCheckedWords(hitWords)
  }, [hitWords])

  const revertMutation = useMutation({
    mutationFn: (removeWords: string[]) =>
      revertKeywordDeduction({
        log_id: log?.id ?? 0,
        remove_words: removeWords,
      }),
    onSuccess: () => {
      toast.success(t('Deduction reverted'))
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-credit-logs'],
      })
      // 打回会删敏感词，同步失效设置页的词库缓存。
      void queryClient.invalidateQueries({ queryKey: ['system-options'] })
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Revert failed'))
    },
  })

  const handleRevert = (removeWords: string[]) => {
    if (!log || revertMutation.isPending) return
    revertMutation.mutate(removeWords)
  }

  const toggleWord = (word: string) => {
    setCheckedWords((prev) =>
      prev.includes(word) ? prev.filter((w) => w !== word) : [...prev, word]
    )
  }

  return (
    <Dialog open={log != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('Revert deduction')}</DialogTitle>
        </DialogHeader>
        {log && (
          <div className='space-y-3 text-sm'>
            <div className='bg-muted/50 rounded-md border p-2.5 text-xs'>
              <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                <span>
                  {t('User')} #{log.user_id}
                </span>
                <span>{t('Points')}: {log.points}</span>
                <span>{formatTs(log.created_at)}</span>
              </div>
              <p className='text-muted-foreground mt-1 break-all'>
                {log.reason}
              </p>
            </div>
            <p>{t('The deducted points will be restored to the user.')}</p>
            {hitWords.length > 0 ? (
              <div className='space-y-1.5'>
                <div className='font-medium'>
                  {t('Also remove from the sensitive-word library')}
                </div>
                {hitWords.map((word) => (
                  <label
                    key={word}
                    className='hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5'
                  >
                    <Checkbox
                      checked={checkedWords.includes(word)}
                      onCheckedChange={() => toggleWord(word)}
                    />
                    <span className='min-w-0 truncate'>{word}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className='text-muted-foreground text-xs'>
                {t('No sensitive words parsed from this reason.')}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant='outline'
            onClick={onClose}
            disabled={revertMutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button
            variant='outline'
            disabled={revertMutation.isPending}
            onClick={() => handleRevert([])}
          >
            {t('Revert only')}
          </Button>
          <Button
            disabled={revertMutation.isPending || checkedWords.length === 0}
            onClick={() => handleRevert(checkedWords)}
          >
            <RotateCcw className='size-4' aria-hidden='true' />
            {t('Revert & remove selected')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      { columnId: '_statusSearch', searchKey: 'status_code', type: 'string' },
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
  const {
    value: statusFilter,
    inputValue: statusFilterInput,
    setInputValue: setStatusFilterInput,
  } = useDebouncedColumnFilter({
    columnFilters,
    columnId: '_statusSearch',
    onColumnFiltersChange,
  })

  const uid = userIdFilter.trim() ? Number(userIdFilter.trim()) : undefined
  const statusNum = statusFilter.trim()
    ? Number(statusFilter.trim())
    : undefined

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'risk-control-conversations',
      pagination.pageIndex,
      globalFilter,
      modelFilter,
      userIdFilter,
      statusFilter,
    ],
    queryFn: () =>
      getConversationRecords({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        request_id: globalFilter || undefined,
        model_name: modelFilter || undefined,
        user_id:
          uid && Number.isFinite(uid) && uid > 0 ? uid : undefined,
        status_code:
          statusNum && Number.isFinite(statusNum) && statusNum > 0
            ? statusNum
            : undefined,
      }),
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo<ColumnDef<ConversationRecord>[]>(
    () => [
      { accessorKey: 'id', header: 'ID' },
      {
        accessorKey: 'user_id',
        header: t('User'),
        cell: ({ row }) => (
          <span className='font-medium'>
            #{row.original.user_id}
            {row.original.username ? ` ${row.original.username}` : ''}
          </span>
        ),
      },
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
            setStatusFilterInput('')
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
              <Input
                placeholder={t('Filter by status...')}
                value={statusFilterInput}
                onChange={(e) => setStatusFilterInput(e.target.value)}
                className='w-full sm:w-28 lg:w-32'
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
        : { thinking: '', content: '', toolCalls: [] },
    [response]
  )
  const requestTurns = useMemo(
    () => (request ? parseRequestTurns(request) : []),
    [request]
  )
  // pi 编码助手把超大工具结果省略为 "[dropped §N§]" 占位（保留在请求文本里）。
  // 渲染成醒目提示，审查时一眼认出该轮工具结果被模型端省略。
  const beautifyDropped = (text: string): string =>
    text.replace(/\[dropped §(\d+)§\]/g, `**${t('Tool result omitted')} #$1**`)

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
          <div className='min-w-0 space-y-3 text-xs'>
            <div className='min-w-0'>
              <div className='mb-1 font-medium'>{t('Request')}</div>
              {request && requestTurns[0]?.role !== '' ? (
                <div className='space-y-1.5'>
                  {requestTurns.map((turn) => {
                    const body = turn.content.join('\n')
                    const preview = (
                      body.split('\n').find((l) => l.trim() !== '') ?? body
                    ).slice(0, 80)
                    return (
                      <Collapsible
                        key={`${turn.role}-${preview.slice(0, 20)}`}
                        className='rounded-md border'
                      >
                        <CollapsibleTrigger
                          render={
                            <button
                              type='button'
                              className='group hover:bg-muted/40 flex w-full items-center justify-between gap-2 p-2 text-left'
                            />
                          }
                        >
                          <span className='flex min-w-0 items-center gap-2'>
                            <span
                              className={`shrink-0 text-[11px] font-medium uppercase tracking-wide ${REQUEST_ROLE_TEXT_COLOR[turn.role] ?? 'text-muted-foreground'}`}
                            >
                              {t(requestRoleLabel(turn.role))}
                            </span>
                            <span className='text-muted-foreground min-w-0 truncate text-xs'>
                              {preview || t('Empty')}
                            </span>
                          </span>
                          <ChevronDown className='text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-180' />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          {body ? (
                            <div className='bg-muted/50 max-h-60 overflow-auto rounded-md p-3'>
                              <Markdown breaks>{beautifyDropped(body)}</Markdown>
                            </div>
                          ) : (
                            <div className='p-2 text-sm'>{t('Empty')}</div>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    )
                  })}
                </div>
              ) : (
                <div className='bg-muted max-h-60 overflow-auto rounded-md p-3'>
                  <Markdown breaks>
                    {request ? beautifyDropped(request) : t('Empty')}
                  </Markdown>
                </div>
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
                    <Collapsible
                      defaultOpen
                      className='bg-muted/50 rounded-md border border-dashed'
                    >
                      <CollapsibleTrigger
                        render={
                          <button
                            type='button'
                            className='group hover:bg-muted/60 flex w-full items-center justify-between gap-2 p-2 text-left'
                          />
                        }
                      >
                        <span className='text-muted-foreground flex items-center gap-1 font-medium'>
                          <Brain className='size-3.5' aria-hidden='true' />
                          {t('Thinking')}
                        </span>
                        <ChevronDown className='text-muted-foreground size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180' />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <pre className='text-muted-foreground max-h-40 overflow-auto break-all whitespace-pre-wrap p-2 pt-0'>
                          {parsed.thinking}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  {parsed.toolCalls.length > 0 && (
                    <div className='space-y-1.5'>
                      <div className='text-muted-foreground flex items-center gap-1 font-medium'>
                        <Wrench className='size-3.5' aria-hidden='true' />
                        {t('Tool calls')}
                        <span className='text-muted-foreground/70 font-mono text-[11px]'>
                          {parsed.toolCalls.length}
                        </span>
                      </div>
                      {parsed.toolCalls.map((tc) => (
                        <Collapsible
                          key={tc.id || tc.name}
                          className='bg-muted/50 rounded-md border border-dashed'
                        >
                          <CollapsibleTrigger
                            render={
                              <button
                                type='button'
                                className='group hover:bg-muted/60 flex w-full items-center justify-between gap-2 p-2 text-left'
                              />
                            }
                          >
                            <span className='min-w-0 truncate font-mono text-[11px] font-medium'>
                              {tc.name || t('Unknown tool')}
                            </span>
                            <span className='flex shrink-0 items-center gap-1.5'>
                              {tc.arguments && (
                                <span className='text-muted-foreground/70 font-mono text-[10px]'>
                                  {formatBytes(tc.arguments.length)}
                                </span>
                              )}
                              <ChevronDown className='text-muted-foreground size-3.5 transition-transform group-data-[panel-open]:rotate-180' />
                            </span>
                          </CollapsibleTrigger>
                          {tc.arguments && (
                            <CollapsibleContent>
                              <pre className='max-h-60 overflow-auto break-all whitespace-pre-wrap p-2 pt-0'>
                                {tc.arguments}
                              </pre>
                            </CollapsibleContent>
                          )}
                        </Collapsible>
                      ))}
                    </div>
                  )}
                  {parsed.usage &&
                    (parsed.usage.prompt_tokens != null ||
                      parsed.usage.completion_tokens != null ||
                      parsed.usage.total_tokens != null ||
                      parsed.usage.input_tokens != null ||
                      parsed.usage.output_tokens != null) && (
                      <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
                        <span className='font-medium'>{t('Tokens')}</span>
                        <span>
                          {t('Input')}{' '}
                          {parsed.usage.prompt_tokens ??
                            parsed.usage.input_tokens ??
                            '-'}
                        </span>
                        <span>
                          {t('Output')}{' '}
                          {parsed.usage.completion_tokens ??
                            parsed.usage.output_tokens ??
                            '-'}
                        </span>
                        {parsed.usage.total_tokens != null && (
                          <span>
                            {t('Total')} {parsed.usage.total_tokens}
                          </span>
                        )}
                      </div>
                    )}
                  {parsed.content ? (
                    <div className='bg-muted max-h-60 overflow-auto rounded-md p-3'>
                      <Markdown breaks>{parsed.content}</Markdown>
                    </div>
                  ) : (
                    <div className='bg-muted rounded-md p-2 text-sm'>
                      {t('Empty')}
                    </div>
                  )}
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

// 错误积压卡片：展示分析窗口内全部/已分析/未分析错误日志数量，以及定量阈值是否已达。
// 未分析占比用进度条可视化，定量模式下阈值达标时提示下一次定时检查会触发分析。
function ErrorBacklogCard() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['risk-control-error-stats'],
    queryFn: getMarkerAnalysisErrorStats,
  })
  const total = data?.total_error_logs ?? 0
  const analyzed = data?.analyzed_error_logs ?? 0
  const unanalyzed = data?.unanalyzed_error_logs ?? 0
  const threshold = data?.threshold_count ?? 0
  const thresholdEnabled = data?.threshold_enabled ?? false
  const thresholdReached =
    thresholdEnabled && threshold > 0 && unanalyzed >= threshold
  const percent =
    total > 0 ? Math.min(100, Math.round((unanalyzed / total) * 100)) : 0

  // 状态说明：阈值已达标 / 仅定量 / 全部关闭 分别提示。
  let statusNote: ReactNode
  if (thresholdReached) {
    statusNote = (
      <p className='text-destructive flex items-center gap-1.5 text-sm'>
        <AlertTriangle className='size-4' aria-hidden='true' />
        {t(
          'Unanalyzed errors reached the trigger threshold; analysis will run on the next error log.'
        )}
      </p>
    )
  } else if (thresholdEnabled && threshold > 0) {
    statusNote = (
      <p className='text-muted-foreground text-xs'>
        {t(
          'Analysis runs automatically once unanalyzed errors reach the threshold. You can also trigger it manually.'
        )}
      </p>
    )
  } else {
    statusNote = (
      <p className='text-muted-foreground text-xs'>
        {t(
          'Automatic analysis is off; use the manual buttons below to run it.'
        )}
      </p>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Error log backlog')}</CardTitle>
        <CardDescription>
          {t(
            'All error logs since the site started, split by whether the AI marker analysis has already processed them. Unanalyzed counts accumulate since the last analysis (no time window).'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {isLoading || !data ? (
          <Skeleton className='h-10 w-full' />
        ) : (
          <>
            <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
              <span className='flex items-center gap-1.5'>
                <span className='text-muted-foreground'>{t('Total')}</span>
                <Badge variant='outline'>{total}</Badge>
              </span>
              <span className='flex items-center gap-1.5'>
                <span className='text-muted-foreground'>{t('Analyzed')}</span>
                <Badge variant='secondary'>{analyzed}</Badge>
              </span>
              <span className='flex items-center gap-1.5'>
                <span className='text-muted-foreground'>{t('Unanalyzed')}</span>
                <Badge
                  variant={thresholdReached ? 'destructive' : 'warning'}
                >
                  {unanalyzed}
                </Badge>
              </span>
              {thresholdEnabled && threshold > 0 && (
                <span className='flex items-center gap-1.5'>
                  <span className='text-muted-foreground'>
                    {t('Trigger threshold')}
                  </span>
                  <Badge variant='outline'>{threshold}</Badge>
                </span>
              )}
            </div>
            <div className='space-y-1'>
              <div className='flex items-center justify-between text-sm'>
                <span className='text-muted-foreground'>
                  {t('Unanalyzed share')}
                </span>
                <span className='text-muted-foreground tabular-nums'>
                  {percent}%
                </span>
              </div>
              <Progress value={percent} />
            </div>
            {statusNote}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// 信用分分布卡：按满分百分比分桶展示全站用户占比。百分比桶随 full_score 等比缩放，
// 调上限/冻结阈值等数值不影响分布形状（不会出现"上限调低后全员落最低桶"的失真）。
const SEGMENT_COLORS: Record<string, string> = {
  '100%': 'bg-emerald-500',
  '80-99%': 'bg-yellow-400',
  '50-79%': 'bg-amber-500',
  '<50%': 'bg-red-500',
}

function CreditScoreDistributionCard() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['risk-control-overview'],
    queryFn: getRiskControlOverview,
  })
  const segments = data?.credit_score_distribution ?? []
  const total = segments.reduce((sum, s) => sum + (s.count ?? 0), 0)
  const pct = (count: number) =>
    total > 0 ? Math.round((count / total) * 100) : 0
  const fullScore = data?.full_score

  let body: ReactNode
  if (isLoading) {
    body = <Skeleton className='h-10 w-full' />
  } else if (segments.length === 0) {
    body = (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        {t('No users yet.')}
      </p>
    )
  } else {
    body = (
      <>
        {/* 堆叠条用 flexGrow 按数量等比分配，避免各段百分比四舍五入后加不满/溢出。 */}
        <div className='flex h-2.5 w-full overflow-hidden rounded-full'>
          {segments.map((s) => (
            <div
              key={s.segment}
              className={SEGMENT_COLORS[s.segment] ?? 'bg-muted'}
              style={{ flexGrow: s.count || 1 }}
              title={`${s.segment}: ${pct(s.count)}%`}
            />
          ))}
        </div>
        <ul className='space-y-1.5 text-sm'>
          {segments.map((s) => {
            const p = pct(s.count)
            return (
              <li key={s.segment} className='flex items-center gap-2'>
                <span
                  className={`size-2.5 shrink-0 rounded-full ${SEGMENT_COLORS[s.segment] ?? 'bg-muted'}`}
                />
                <span className='w-14 shrink-0 font-medium'>
                  {s.segment}
                </span>
                <div className='bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full'>
                  <div
                    className={`h-full ${SEGMENT_COLORS[s.segment] ?? 'bg-muted'}`}
                    style={{ width: `${p}%` }}
                  />
                </div>
                <span className='text-muted-foreground w-24 shrink-0 text-right tabular-nums whitespace-nowrap'>
                  {p}% · {s.count}
                </span>
              </li>
            )
          })}
        </ul>
        {fullScore != null && fullScore > 0 && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Brackets are percentages of the configured full score ({{full_score}}).',
              { full_score: fullScore }
            )}
          </p>
        )}
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Credit score distribution')}</CardTitle>
        <CardDescription>
          {t(
            'Share of users by credit score as a percentage of the full score. Brackets scale with the configured full score, so changing limits does not distort the picture.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>{body}</CardContent>
    </Card>
  )
}

// 全量重新分析卡：把分析任务水位线重置到 0，从建站第一条错误日志开始强制全跑（不跳过任何
// 已分析日志），与常规（水位线增量）分析共用同一条后台任务，带进度轮询。适合换了标记词/
// 分析模型后想整站重查。
function FullReanalysisCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false)

  const { data, isFetching } = useQuery({
    queryKey: ['risk-control-analysis-status'],
    queryFn: getMarkerAnalysisStatus,
    // 分析在跑时每 2s 轮询进度；结束后自动停。
    refetchInterval: (query) => {
      const s = query.state.data
      return s?.running ? 2000 : false
    },
  })

  const invalidateStatus = () => {
    void queryClient.invalidateQueries({
      queryKey: ['risk-control-analysis-status'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['risk-control-error-stats'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['risk-control-analysis-logs'],
    })
    void queryClient.invalidateQueries({ queryKey: ['risk-control-suggestions'] })
  }

  const forceMutation = useMutation({
    mutationFn: () => analyzeMarkers({ force: true }),
    onSuccess: invalidateStatus,
    onError: () => toast.error(t('Analysis failed')),
  })

  const running = data?.running ?? false
  const state = data?.state

  let body: ReactNode
  if (isFetching && !data) {
    body = <Skeleton className='h-10 w-full' />
  } else if (running) {
    body = (
      <div className='space-y-2'>
        <div className='flex items-center justify-between text-sm'>
          <span className='text-muted-foreground'>
            {t('Analyzing error logs…')}
          </span>
          <span className='tabular-nums'>{state?.progress ?? 0}%</span>
        </div>
        <Progress value={state?.progress ?? 0} />
        <p className='text-muted-foreground text-xs'>
          {t(
            'Processed {{processed}} / {{total}} error logs, {{suggestions}} suggestions so far.',
            {
              processed: state?.processed ?? 0,
              total: state?.total ?? 0,
              suggestions: state?.suggestions ?? 0,
            }
          )}
        </p>
      </div>
    )
  } else {
    body = (
      <p className='text-muted-foreground text-sm'>
        {t(
          'Re-feeds every error log since the site was first set up, including ones already analyzed. Useful after changing the violation markers or the analysis model.'
        )}
      </p>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Full re-analysis')}</CardTitle>
        <CardDescription>
          {t(
            'Reset the analysis progress and re-run from the very first error log. All error texts are fed to the model; results are deduplicated against existing markers.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {body}
        {data?.last && !running && (
          <div
            className={`bg-muted/40 rounded-md border p-2.5 text-xs ${
              data.last.error ? 'border-destructive/40' : ''
            }`}
          >
            {data.last.error ? (
              <p className='text-destructive break-all'>
                {t('Last analysis failed: {{error}}', {
                  error: data.last.error,
                })}
              </p>
            ) : (
              <p className='text-muted-foreground'>
                {t('Last analysis: {{analyzed}} error texts, {{suggestions}} suggestions.', {
                  analyzed: data.last.analyzed,
                  suggestions: data.last.suggestions,
                })}
              </p>
            )}
          </div>
        )}
        {!running && (
          <div className='flex flex-wrap items-center gap-2 border-t pt-3'>
            <Button
              size='sm'
              variant='destructive'
              disabled={forceMutation.isPending}
              onClick={() => setForceConfirmOpen(true)}
            >
              <RefreshCw className='size-4' aria-hidden='true' />
              {t('Re-analyze from site start')}
            </Button>
            <ConfirmDialog
              open={forceConfirmOpen}
              onOpenChange={setForceConfirmOpen}
              title={t('Re-analyze everything from the start?')}
              desc={t(
                'This resets the analysis progress to zero and re-feeds every error log since the site was set up to the model. It can take a while and costs tokens.'
              )}
              confirmText={t('Re-analyze from site start')}
              isLoading={forceMutation.isPending}
              handleConfirm={() => {
                setForceConfirmOpen(false)
                forceMutation.mutate()
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MarkersTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [markersText, setMarkersText] = useState<string | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [analysisPage, setAnalysisPage] = useState(1)
  const ANALYSIS_PAGE_SIZE = 10

  const { data: markerData } = useQuery({
    queryKey: ['risk-control-markers'],
    queryFn: getMarkers,
  })
  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['risk-control-suggestions'],
    queryFn: () =>
      getMarkerSuggestions({ p: 1, page_size: 20, status: 'pending' }),
  })
  const { data: analysisLogs } = useQuery({
    queryKey: ['risk-control-analysis-logs', analysisPage],
    queryFn: () =>
      getMarkerAnalysisLogs({ p: analysisPage, page_size: ANALYSIS_PAGE_SIZE }),
  })
  const analysisTotalPages = Math.max(
    1,
    Math.ceil((analysisLogs?.total ?? 0) / ANALYSIS_PAGE_SIZE)
  )

  const saveMarkersMutation = useMutation({
    mutationFn: updateMarkers,
    onSuccess: () => {
      toast.success(t('Saved'))
      // 保存后清空本地编辑态，回到服务端驱动：Reset 才能真正撤销"未保存的编辑"。
      setMarkersText(null)
      void queryClient.invalidateQueries({ queryKey: ['risk-control-markers'] })
    },
    onError: () => toast.error(t('Save failed')),
  })
  // 重置 = 恢复系统初始自带的默认屏蔽词（写后端并刷新）。
  const resetMarkersMutation = useMutation({
    mutationFn: resetMarkers,
    onSuccess: () => {
      toast.success(t('Markers reset to defaults'))
      setMarkersText(null)
      void queryClient.invalidateQueries({ queryKey: ['risk-control-markers'] })
    },
    onError: () => toast.error(t('Save failed')),
  })
  const analyzeMutation = useMutation({
    mutationFn: (opts: { force?: boolean }) => analyzeMarkers(opts),
    onSuccess: (r) => {
      toast.success(
        r.started
          ? t('Analysis started; progress is shown in the overview.')
          : t('An analysis is already running.')
      )
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-analysis-status'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-analysis-logs'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['risk-control-error-stats'],
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
              disabled={resetMarkersMutation.isPending}
              onClick={() => setResetConfirmOpen(true)}
            >
              {t('Reset')}
            </Button>
            <ConfirmDialog
              open={resetConfirmOpen}
              onOpenChange={setResetConfirmOpen}
              title={t('Reset violation markers?')}
              desc={t(
                'This replaces the current violation markers with the built-in defaults. Your custom markers will be lost.'
              )}
              destructive
              confirmText={t('Reset')}
              isLoading={resetMarkersMutation.isPending}
              handleConfirm={() => {
                setResetConfirmOpen(false)
                resetMarkersMutation.mutate()
              }}
            />
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
              onClick={() => analyzeMutation.mutate({})}
            >
              <Sparkles className='size-4' aria-hidden='true' />
              {t('Analyze logs for new markers')}
            </Button>
            <Button
              size='sm'
              variant='destructive'
              disabled={analyzeMutation.isPending}
              onClick={() => analyzeMutation.mutate({ force: true })}
            >
              <RefreshCw className='size-4' aria-hidden='true' />
              {t('Force re-analyze')}
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

      <Card>
        <CardHeader>
          <CardTitle>{t('Analysis history')}</CardTitle>
        </CardHeader>
        <CardContent>
          {analysisLogs?.items?.length ? (
            <div className='space-y-2'>
              {analysisLogs.items.map((log) => (
                <div
                  key={log.id}
                  className='bg-muted/40 rounded-md border p-2.5 text-xs'
                >
                  <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                    <span className='text-muted-foreground'>
                      {formatTs(log.created_at)}
                    </span>
                    <Badge
                      variant={
                        TRIGGER_BADGE_VARIANT[log.triggered_by] ?? 'outline'
                      }
                    >
                      {analysisTriggerLabel(log.triggered_by, t)}
                    </Badge>
                    <span>
                      {t('analyzed')} {log.analyzed_count}
                    </span>
                    {log.total_tokens > 0 ? (
                      <span>
                        {t('Tokens')}: {log.total_tokens}
                      </span>
                    ) : (
                      <span className='text-muted-foreground'>
                        {t('No model call')}
                      </span>
                    )}
                    <span>
                      {t('suggestions')} {log.suggestions_count}
                    </span>
                    {log.retried > 0 && (
                      <Badge variant='warning' className='tabular-nums'>
                        {t('Retried {{count}}× on rate limit', {
                          count: log.retried,
                        })}
                      </Badge>
                    )}
                    {log.prompt_used === 'default' && (
                      <Badge variant='outline'>{t('Default prompt')}</Badge>
                    )}
                    {log.prompt_used &&
                      log.prompt_used !== 'default' && (
                        <Badge
                          variant='secondary'
                          className='max-w-56 truncate'
                          title={log.prompt_used}
                        >
                          {t('Custom prompt')}: {log.prompt_used}
                        </Badge>
                      )}
                    {log.model && (
                      <span className='text-muted-foreground'>
                        {log.model}
                      </span>
                    )}
                  </div>
                  {log.error_message && (
                    <p className='text-destructive mt-1 break-all'>
                      {log.error_message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className='text-muted-foreground py-4 text-center text-sm'>
              {t('No analysis history')}
            </p>
          )}
          {analysisTotalPages > 1 && (
            <div className='mt-3 flex items-center justify-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={analysisPage <= 1}
                onClick={() => setAnalysisPage((p) => Math.max(1, p - 1))}
              >
                {t('Previous')}
              </Button>
              <span className='text-sm'>
                {analysisPage} / {analysisTotalPages}
              </span>
              <Button
                variant='outline'
                size='sm'
                disabled={analysisPage >= analysisTotalPages}
                onClick={() =>
                  setAnalysisPage((p) => Math.min(analysisTotalPages, p + 1))
                }
              >
                {t('Next')}
              </Button>
            </div>
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
            {s.log_ids ? (
              <div className='text-muted-foreground/70 mt-1 font-mono text-[11px]'>
                {t('Source error logs')}: {s.log_ids}
              </div>
            ) : (
              <div className='text-muted-foreground/70 mt-1 text-[11px]'>
                {t('No source error log matched')}
              </div>
            )}
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
// 统计（关键词/用户命中排行，图表与控件样式照数据看板）
// ---------------------------------------------------------------------------

// 时间范围预设：7/30/90 天 / 全部（0=全部）。由「偏好设置」对话框选择，作为两张图的默认范围。
const HIT_STATS_RANGE_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'All time', value: 0 },
]

// 命中统计默认时间范围持久化（照数据看板 saveChartPreferences 模式）。
const HIT_STATS_RANGE_STORAGE_KEY = 'risk_control_hit_stats_default_range'
const DEFAULT_HIT_STATS_RANGE = 30

function getSavedHitStatsRange(): number {
  if (typeof window === 'undefined') return DEFAULT_HIT_STATS_RANGE
  const saved = Number(window.localStorage.getItem(HIT_STATS_RANGE_STORAGE_KEY))
  return HIT_STATS_RANGE_OPTIONS.some((option) => option.value === saved)
    ? saved
    : DEFAULT_HIT_STATS_RANGE
}

function saveHitStatsRange(days: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(HIT_STATS_RANGE_STORAGE_KEY, String(days))
}

const HIT_CHART_TYPE_OPTIONS = [
  { value: 'bar', labelKey: 'Ranking' },
  { value: 'pie', labelKey: 'Proportion' },
] as const

type HitChartType = (typeof HIT_CHART_TYPE_OPTIONS)[number]['value']

// 排名柱状图显示前 N，饼图显示前 M（分片太多看不清）。
const HIT_CHART_TOP_N = 15
const HIT_PIE_TOP_N = 10

// VChart 主题管理器按需加载（与数据看板图表一致），亮/暗主题切换用。
let statsChartThemePromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

// HitChartDataItem 命中图的一行：name 为关键词/用户名，value 为次数。
type HitChartDataItem = { name: string; value: number }

// HitChart 命中排行/占比图卡片：样式照数据看板（bordered 容器 + IconBadge 头 +
// 图表类型分段控件 + VChart）。bar=横向排名条（传 stackRows 时堆叠成多段），
// pie=占比。标题由卡片头部承担，spec 内不重复渲染标题。
function HitChart({
  title,
  icon,
  data,
  stackRows,
  total,
  chartType,
  onChartTypeChange,
  loading,
}: {
  title: string
  icon: ReactNode
  data: HitChartDataItem[]
  /** 堆叠柱行（含 series 分段，如 敏感词命中/上游违规）；提供时 bar 用堆叠柱。 */
  stackRows?: Array<HitChartDataItem & { series: string }>
  total: number
  chartType: HitChartType
  onChartTypeChange: (t: HitChartType) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)
  const themeManagerRef = useRef<
    (typeof import('@visactor/vchart'))['ThemeManager'] | null
  >(null)

  useEffect(() => {
    const updateTheme = async () => {
      setThemeReady(false)
      if (!statsChartThemePromise) {
        statsChartThemePromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }
      const ThemeManager = await statsChartThemePromise
      themeManagerRef.current = ThemeManager
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }
    void updateTheme()
  }, [resolvedTheme])

  const colors = getDashboardChartColors(data.length)
  const hasStack = Boolean(stackRows && stackRows.length > 0)
  const stackSeries = hasStack && stackRows
      ? Array.from(new Set(stackRows.map((r) => r.series)))
      : []
  const pieValues = data
    .slice(0, HIT_PIE_TOP_N)
    .map((d) => ({ type: d.name, value: d.value }))
  const barValues =
    hasStack && stackRows
      ? stackRows.slice(0, HIT_CHART_TOP_N)
      : data.slice(0, HIT_CHART_TOP_N)

  const spec =
    chartType === 'bar'
      ? {
          type: 'bar',
          data: [{ id: 'hitBarData', values: barValues }],
          yField: 'name',
          xField: 'value',
          seriesField: hasStack ? 'series' : 'name',
          direction: 'horizontal',
          stack: hasStack,
          legends: hasStack
            ? { visible: true, selectMode: 'single' }
            : { visible: false },
          color: hasStack
            ? {
                type: 'ordinal',
                domain: stackSeries,
                range: getDashboardChartColors(stackSeries.length),
              }
            : { type: 'ordinal', range: colors },
          bar: { state: { hover: { stroke: '#000', lineWidth: 1 } } },
          label: {
            visible: true,
            position: 'outside',
            style: { fontSize: 11 },
          },
          axes: [
            { orient: 'left', type: 'band' },
            { orient: 'bottom', type: 'linear', visible: false },
          ],
          tooltip: {
            mark: {
              content: [
                {
                  key: (datum: Record<string, unknown>) =>
                    hasStack ? datum?.series : datum?.name,
                  value: (datum: Record<string, unknown>) =>
                    Number(datum?.value) || 0,
                },
              ],
            },
          },
          background: { fill: 'transparent' },
          animation: true,
        }
      : {
          type: 'pie',
          data: [{ id: 'hitPieData', values: pieValues }],
          outerRadius: 0.8,
          innerRadius: 0.5,
          padAngle: 0.6,
          valueField: 'value',
          categoryField: 'type',
          legends: { visible: true, orient: 'left' },
          label: { visible: true },
          color: { type: 'ordinal', range: colors },
          tooltip: {
            mark: {
              content: [
                {
                  key: (datum: Record<string, unknown>) => datum?.type,
                  value: (datum: Record<string, unknown>) =>
                    Number(datum?.value) || 0,
                },
              ],
            },
          },
          background: { fill: 'transparent' },
          animation: true,
        }

  let chartBody: ReactNode
  if (loading && data.length === 0) {
    chartBody = <Skeleton className='h-full w-full' />
  } else if (data.length === 0) {
    chartBody = (
      <p className='text-muted-foreground flex h-full items-center justify-center text-sm'>
        {t('No data available')}
      </p>
    )
  } else if (themeReady) {
    chartBody = (
      <VChart
        key={`${chartType}-${resolvedTheme}-${data.length}`}
        spec={{
          ...spec,
          theme: resolvedTheme === 'dark' ? 'dark' : 'light',
          background: 'transparent',
        }}
        option={VCHART_OPTION}
      />
    )
  } else {
    chartBody = null
  }

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex w-full flex-col gap-1.5 border-b px-3 py-2 sm:gap-3 sm:px-5 sm:py-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='chart-4' size='sm'>
            {icon}
          </IconBadge>
          <div className='text-sm font-semibold'>{t(title)}</div>
          <span className='text-muted-foreground text-xs'>
            {t('Total:')} {total}
          </span>
        </div>
        <div className='bg-muted/60 inline-flex h-7 w-full overflow-x-auto rounded-lg border p-0.5 sm:h-8 sm:w-auto'>
          {HIT_CHART_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type='button'
              onClick={() => onChartTypeChange(opt.value)}
              className={`shrink-0 rounded-md px-3 text-xs font-medium transition-colors ${
                chartType === opt.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>{chartBody}</div>
    </div>
  )
}

// 统计 Tab：关键词命中排行 + 用户命中排行（敏感词命中 + 上游违规命中拼成堆叠柱），
// 时间范围走「偏好设置」对话框。控件/图表样式照数据看板。
function StatsTab() {
  const { t } = useTranslation()
  const [rangeDays, setRangeDays] = useState<number>(getSavedHitStatsRange)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [keywordChartType, setKeywordChartType] = useState<HitChartType>('bar')
  const [userChartType, setUserChartType] = useState<HitChartType>('bar')

  const handleRangeSave = (days: number) => {
    saveHitStatsRange(days)
    setRangeDays(days)
  }

  const { data: keywordData, isLoading: keywordLoading } = useQuery({
    queryKey: ['risk-control-keyword-stats', rangeDays],
    queryFn: () => getKeywordHitStats({ days: rangeDays }),
    placeholderData: (previousData) => previousData,
  })
  const { data: userData, isLoading: userLoading } = useQuery({
    queryKey: ['risk-control-user-hit-stats', rangeDays],
    queryFn: () => getUserHitStats({ days: rangeDays }),
    placeholderData: (previousData) => previousData,
  })

  const keywordItems = (keywordData?.items ?? []).map((s) => ({
    name: s.keyword,
    value: s.count,
  }))
  const userItems = (userData?.items ?? []).map((s) => ({
    name: s.username || `#${s.user_id}`,
    value: s.count,
  }))
  // 用户堆叠柱：同一用户拆成「敏感词命中 / 上游违规命中」两段，一条记一次。
  const userStackRows: Array<HitChartDataItem & { series: string }> = (
    userData?.items ?? []
  ).flatMap((s) => {
    const name = s.username || `#${s.user_id}`
    const rows: Array<HitChartDataItem & { series: string }> = []
    if (s.keyword_count > 0) {
      rows.push({ name, series: t('Sensitive-word hit'), value: s.keyword_count })
    }
    if (s.upstream_count > 0) {
      rows.push({ name, series: t('Upstream violation'), value: s.upstream_count })
    }
    return rows
  })
  const keywordTotal = keywordItems.reduce((sum, s) => sum + s.value, 0)
  const userTotal = userItems.reduce((sum, s) => sum + s.value, 0)

  return (
    <div className='space-y-4'>
      <div className='flex justify-end'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setPreferencesOpen(true)}
        >
          <Settings2 className='mr-2 h-4 w-4' />
          {t('Preferences')}
        </Button>
      </div>
      <HitChart
        title='Keyword Hit Ranking'
        icon={<Hash className='size-4' />}
        data={keywordItems}
        total={keywordTotal}
        chartType={keywordChartType}
        onChartTypeChange={setKeywordChartType}
        loading={keywordLoading}
      />
      <HitChart
        title='User Hit Ranking'
        icon={<Users className='size-4' />}
        data={userItems}
        stackRows={userStackRows}
        total={userTotal}
        chartType={userChartType}
        onChartTypeChange={setUserChartType}
        loading={userLoading}
      />
      <StatsPreferencesDialog
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
        days={rangeDays}
        onSave={handleRangeSave}
      />
    </div>
  )
}

// 偏好设置对话框：设置命中统计图的默认时间范围（照数据看板「偏好设置」样式）。
function StatsPreferencesDialog({
  open,
  onOpenChange,
  days,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  days: number
  onSave: (days: number) => void
}) {
  const { t } = useTranslation()
  const [draftDays, setDraftDays] = useState(days)

  useEffect(() => {
    if (open) setDraftDays(days)
  }, [open, days])

  return (
    <SettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Hit Statistics Defaults')}
      description={t('Set the default time range for the hit statistics charts.')}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      bodyClassName='grid gap-3'
      footer={
        <Button
          type='button'
          onClick={() => {
            onSave(draftDays)
            onOpenChange(false)
          }}
        >
          <Save className='mr-2 h-4 w-4' />
          {t('Save')}
        </Button>
      }
    >
      <div className='grid gap-1.5'>
        <Label htmlFor='hit-stats-time-range'>{t('Default range')}</Label>
        <Select
          items={HIT_STATS_RANGE_OPTIONS.map((option) => ({
            value: String(option.value),
            label: t(option.label),
          }))}
          value={String(draftDays)}
          onValueChange={(value) => setDraftDays(Number(value))}
        >
          <SelectTrigger id='hit-stats-time-range'>
            <SelectValue placeholder={t('Select default range')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {HIT_STATS_RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {t(option.label)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </SettingsDialog>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// 概览 Tab：顶部统计卡 + 错误积压卡 + 信用分分布卡 + 全量重新分析卡。默认页。
function OverviewTab() {
  return (
    <div className='space-y-4'>
      <OverviewCards />
      <div className='grid gap-4 lg:grid-cols-2'>
        <ErrorBacklogCard />
        <CreditScoreDistributionCard />
      </div>
      <FullReanalysisCard />
    </div>
  )
}

type RiskControlTab =
  | 'overview'
  | 'users'
  | 'logs'
  | 'conversations'
  | 'stats'
  | 'markers'

export function RiskControlPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = route.useSearch()
  const activeTab: RiskControlTab = search.tab ?? 'overview'
  // 批量模式开关：放页面头部，作用于「信用日志」tab 的表格。
  const [batchMode, setBatchMode] = useState(false)

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
      <SectionPageLayout.Actions>
        {/* 批量模式开关：放页面头部（与渠道一致），作用于「信用日志」tab 的表格。 */}
        <TogglePill
          id='risk-credit-batch-mode'
          label={t('Batch Operations')}
          icon={<ListChecks className='text-muted-foreground h-4 w-4' aria-hidden='true' />}
          checked={batchMode}
          onCheckedChange={setBatchMode}
        />
        {/* 快速跳转到安全设置里的敏感词页（关键词过滤与风控扣分共用一套词库的配置入口）。 */}
        <Button
          variant='outline'
          size='sm'
          render={
            <Link
              to='/system-settings/security/$section'
              params={{ section: 'sensitive-words' }}
            />
          }
        >
          <Settings2 data-icon='inline-start' />
          {t('Sensitive word settings')}
        </Button>
        <MobileToggleMenu>
          <ToggleMenuItem
            label={t('Batch Operations')}
            icon={<ListChecks className='size-4' aria-hidden='true' />}
            checked={batchMode}
            onCheckedChange={setBatchMode}
          />
        </MobileToggleMenu>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value='overview'>{t('Overview')}</TabsTrigger>
              <TabsTrigger value='users'>{t('Low Score Users')}</TabsTrigger>
              <TabsTrigger value='logs'>{t('Credit Logs')}</TabsTrigger>
              <TabsTrigger value='conversations'>
                {t('Conversations')}
              </TabsTrigger>
              <TabsTrigger value='stats'>{t('Statistics')}</TabsTrigger>
              <TabsTrigger value='markers'>{t('Markers')}</TabsTrigger>
            </TabsList>
            <TabsContent value='overview'>
              <OverviewTab />
            </TabsContent>
            <TabsContent value='users'>
              <LowScoreUsersTab />
            </TabsContent>
            <TabsContent value='logs'>
              <CreditLogsTab batchMode={batchMode} />
            </TabsContent>
            <TabsContent value='conversations'>
              <ConversationsTab />
            </TabsContent>
            <TabsContent value='stats'>
              <StatsTab />
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
