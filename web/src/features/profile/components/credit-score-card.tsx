/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'

interface CreditStatus {
  credit_score: number
  enabled: boolean
  frozen: boolean
  freeze_threshold: number
  full_score: number
  pledge_points: number
  pledge_cooldown_seconds: number
  next_pledge_at: number
  pledge_read_count: number
}

function unwrapData<T>(body: {
  success?: boolean
  message?: string
  data?: T
}): T {
  if (!body?.success) {
    throw new Error(body?.message || 'Request failed')
  }
  return body.data as T
}

async function getCreditStatus(): Promise<CreditStatus> {
  const res = await api.get('/api/user/credit')
  return unwrapData<CreditStatus>(res.data)
}

async function doPledge(): Promise<{
  cooldown?: boolean
  credit_score?: number
  next_pledge_at?: number
}> {
  const res = await api.post('/api/user/credit/pledge')
  return unwrapData(res.data)
}

function PledgeDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  pledgePoints,
  cooldownDays,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isPending: boolean
  pledgePoints: number
  cooldownDays: number
}) {
  const { t } = useTranslation()
  const [agreed, setAgreed] = useState(false)

  // 每次打开重置勾选状态。
  useEffect(() => {
    if (!open) setAgreed(false)
  }, [open])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !isPending && onOpenChange(false)}
    >
      <DialogContent className='max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{t('Content Safety Pledge')}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3 text-sm'>
          <div className='space-y-2'>
            <p>
              {t(
                'I promise to comply with the platform usage rules and will not generate, spread, or induce content that violates laws, regulations, or the platform content-safety policy.'
              )}
            </p>
            <p>
              {t(
                'I understand that repeated violations will keep deducting credit points, and serious cases may freeze my API access.'
              )}
            </p>
            <p>
              {t(
                'I will use the API for legitimate purposes only.'
              )}
            </p>
          </div>
          <div className='bg-muted rounded-md border p-3 text-xs'>
            <div className='mb-1 font-medium'>
              {t('Before you pledge, please note')}
            </div>
            <ul className='list-disc space-y-1 pl-4'>
              <li>
                {t(
                  'Completing the pledge recovers +{{points}} points, available once every {{days}} days.',
                  { points: pledgePoints, days: cooldownDays }
                )}
              </li>
              <li>
                {t(
                  'Daily score recovery still follows the passive rules; the pledge is only an active supplement.'
                )}
              </li>
              <li>
                {t(
                  'Violations after the pledge are still deducted as usual.'
                )}
              </li>
            </ul>
          </div>
          <div className='flex items-start gap-2 rounded-md border p-3'>
            <Checkbox
              id='pledge-agree'
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(Boolean(checked))}
            />
            <label
              htmlFor='pledge-agree'
              className='cursor-pointer text-sm leading-5'
            >
              {t('I have read and agree to the pledge above.')}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={!agreed || isPending}
            onClick={onConfirm}
          >
            {t('Confirm pledge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CreditScoreCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pledgeOpen, setPledgeOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['user-credit'],
    queryFn: getCreditStatus,
  })

  const mutation = useMutation({
    mutationFn: doPledge,
    onSuccess: (r) => {
      if (r.cooldown) {
        toast.info(t('Pledge on cooldown'))
      } else {
        toast.success(t('Pledge completed'))
        void queryClient.invalidateQueries({ queryKey: ['user-credit'] })
      }
      setPledgeOpen(false)
    },
    onError: () => toast.error(t('Pledge failed')),
  })

  // 风控未启用时不展示。
  if (!isLoading && !data?.enabled) {
    return null
  }

  const score = data?.credit_score ?? 0
  const fullScore = data?.full_score ?? 650
  const atFullScore = score >= fullScore
  const nextAt = data?.next_pledge_at ?? 0
  const now = Math.floor(Date.now() / 1000)
  const cooldownRemain = nextAt > now ? nextAt - now : 0
  const cooldownText =
    cooldownRemain > 0 ? `${Math.ceil(cooldownRemain / 3600)}h` : ''
  const cooldownDays = Math.max(
    1,
    Math.ceil((data?.pledge_cooldown_seconds ?? 7 * 86400) / 86400)
  )

  let hint: string
  if (cooldownText) {
    hint = t('Next pledge available in {{time}}', { time: cooldownText })
  } else if (atFullScore) {
    hint = t('Full score reached, no pledge needed')
  } else {
    hint = t('Complete the pledge to recover {{points}} points', {
      points: data?.pledge_points ?? 0,
    })
  }

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between space-y-0'>
        <div>
          <CardTitle>{t('Credit Score')}</CardTitle>
          <CardDescription>
            {t(
              'Deducted on content-safety violations. Frozen accounts cannot call the API.'
            )}
          </CardDescription>
        </div>
        <Badge variant={data?.frozen ? 'destructive' : 'outline'}>
          {data?.frozen ? t('Frozen') : t('Normal')}
        </Badge>
      </CardHeader>
      <CardContent className='space-y-3'>
        {isLoading || !data ? (
          <Skeleton className='h-9 w-24' />
        ) : (
          <div className='flex items-end gap-2'>
            <span className='text-3xl font-semibold'>{data.credit_score}</span>
            <span className='text-muted-foreground text-xs'>
              / {data.full_score}
            </span>
          </div>
        )}
        <p className='text-muted-foreground text-xs'>
          {t('Pledged')}: {data?.pledge_read_count ?? 0} ·{' '}
          {t('Freeze threshold')}: {data?.freeze_threshold ?? '-'}
        </p>
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-xs'>{hint}</span>
          <Button
            variant='outline'
            size='sm'
            disabled={atFullScore || mutation.isPending || !!cooldownText}
            onClick={() => setPledgeOpen(true)}
          >
            {t('Complete pledge')}
          </Button>
        </div>
      </CardContent>
      <PledgeDialog
        open={pledgeOpen}
        onOpenChange={setPledgeOpen}
        onConfirm={() => mutation.mutate()}
        isPending={mutation.isPending}
        pledgePoints={data?.pledge_points ?? 0}
        cooldownDays={cooldownDays}
      />
    </Card>
  )
}
