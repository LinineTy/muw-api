// @muw-owned
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  Loader2,
  MessagesSquare,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { fetchActiveChatKey } from '@/features/chat/hooks/use-active-chat-key'
import { useChatPresets } from '@/features/chat/hooks/use-chat-presets'
import {
  chatLinkRequiresApiKey,
  resolveChatUrl,
  type ChatPreset,
} from '@/features/chat/lib/chat-links'

/** 行尾指示：拉起中转圈、http 客户端 →、本地客户端 ↗ */
function RowTrailing({ type, loading }: { type: ChatPreset['type']; loading: boolean }) {
  if (loading) {
    return (
      <Loader2
        className='text-muted-foreground size-4 shrink-0 animate-spin'
        aria-hidden='true'
      />
    )
  }
  return type === 'web' ? (
    <ChevronRight
      className='text-muted-foreground size-4 shrink-0'
      aria-hidden='true'
    />
  ) : (
    <ArrowUpRight
      className='text-muted-foreground size-4 shrink-0'
      aria-hidden='true'
    />
  )
}

/**
 * OS 桌面壳 · 「第三方接入」弹窗。
 *
 * 管理端配的对话客户端，两类走法：
 *   - http 客户端（`type=web`）→ 进站内 `/chat/<id>`，在窗口里 iframe 打开
 *   - 本地客户端（custom-protocol，如 `cherrystudio://`）→ 带密钥直接拉起
 * 原先是球 + 下拉菜单，2026-09-21要"弹窗、好看些"：改成一行一个客户端卡片，
 * 拉起期间该行显示转圈并禁用，成功后关弹窗。
 *
 * `fluent` 类型和其它两处入口一样过滤掉（它是上游残留类型，站内不渲染）。
 */
export function OsThirdPartyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { chatPresets, serverAddress } = useChatPresets()
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null)
  const loadingRef = useRef<string | null>(null)

  const visiblePresets = useMemo(
    () => chatPresets.filter((preset) => preset.type !== 'fluent'),
    [chatPresets]
  )

  const handleOpenExternal = useCallback(
    async (preset: ChatPreset) => {
      if (preset.type === 'web') return

      const needsKey = chatLinkRequiresApiKey(preset.url)
      let activeKey: string | undefined

      // 连点两次别各拉一次密钥：第一次没回来之前先提示
      if (needsKey && loadingRef.current) {
        toast.info(t('Preparing your chat link, please try again in a moment.'))
        return
      }

      if (needsKey) {
        loadingRef.current = preset.id
        setLoadingPresetId(preset.id)
        try {
          activeKey = await fetchActiveChatKey()
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : t(
                  'Unable to prepare chat link. Please ensure you have an enabled API key.'
                )
          toast.error(message)
          return
        } finally {
          loadingRef.current = null
          setLoadingPresetId(null)
        }
      }

      const url = resolveChatUrl({
        template: preset.url,
        apiKey: needsKey ? activeKey : undefined,
        serverAddress,
      })

      if (!url) {
        toast.error(t('Invalid chat link. Please contact the administrator.'))
        return
      }

      window.open(url, '_blank', 'noopener')
      onOpenChange(false)
    },
    [onOpenChange, serverAddress, t]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Third-party Integration')}
      contentClassName='sm:max-w-lg'
    >
      <div className='flex flex-col gap-2' data-testid='third-party-list'>
        {visiblePresets.map((preset) => {
          const loading = loadingPresetId === preset.id
          const rowClassName =
            'flex items-center gap-3 rounded-lg border p-3 text-start transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60'
          const trailing = <RowTrailing type={preset.type} loading={loading} />

          return preset.type === 'web' ? (
            <Link
              key={preset.id}
              to='/chat/$chatId'
              params={{ chatId: preset.id }}
              className={rowClassName}
              onClick={() => onOpenChange(false)}
            >
              <MessagesSquare
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
              <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                {preset.name}
              </span>
              {trailing}
            </Link>
          ) : (
            <button
              key={preset.id}
              type='button'
              title={t('Open in new tab')}
              disabled={loading}
              className={rowClassName}
              onClick={() => void handleOpenExternal(preset)}
            >
              <ExternalLink
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
              <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                {preset.name}
              </span>
              {trailing}
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}
