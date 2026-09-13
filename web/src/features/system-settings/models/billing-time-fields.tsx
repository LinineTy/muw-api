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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  COMMON_TIMEZONES,
  TIME_FUNCS,
} from '@/features/pricing/lib/billing-expr'
import type { VisualComparison } from '@/features/pricing/lib/billing-expression/visual'

import { DraftNumberInput } from './draft-number-input'

const PROBE_LABELS = {
  hour: 'Hour of day',
  minute: 'Minute',
  weekday: 'Weekday',
  month: 'Month number',
  day: 'Day of month',
  p: 'Billable input tokens',
  c: 'Billable output tokens',
  len: 'Full input length',
} as const

export function BillingTimeProbeFields(props: {
  probe: VisualComparison['probe']
  timezone: string
  includeTokens?: boolean
  /**
   * 阶梯条件专用：只给计费/长度探针（len / p / c），时间类探针归乘数区（请求规则）。
   * 2026-09-12 maintainer定：「旧版阶梯条件里只有输入输出相关的，新版把条件乘数区的全加上了」
   * —— 上游 rework 把两套变量合成一套，按 fork 口径拆回。
   * 当前值若本来就是时间探针（老文档/上游风格表达式），仍并入选项以免显示成空值、保存即损坏。
   */
  tokensOnly?: boolean
  invalidTimezone?: boolean
  onChange: (probe: VisualComparison['probe'], timezone: string) => void
}) {
  const { t } = useTranslation()
  const probes: VisualComparison['probe'][] = props.tokensOnly
    ? (['len', 'p', 'c'] as VisualComparison['probe'][])
    : [...TIME_FUNCS]
  if (props.includeTokens && !props.tokensOnly) probes.push('len', 'p', 'c')
  if (!probes.includes(props.probe)) probes.push(props.probe)
  const isTime = (TIME_FUNCS as readonly string[]).includes(props.probe)
  const zones = COMMON_TIMEZONES.map((zone) => ({
    value: zone.value,
    label: zone.value,
  }))
  if (!zones.some((zone) => zone.value === props.timezone)) {
    zones.push({ value: props.timezone, label: props.timezone || 'UTC' })
  }
  return (
    <>
      <Select
        items={probes.map((probe) => ({
          value: probe,
          label: t(PROBE_LABELS[probe]),
        }))}
        value={props.probe}
        onValueChange={(probe) =>
          probe && props.onChange(probe, props.timezone || 'UTC')
        }
      >
        <SelectTrigger
          aria-label={t('Condition input')}
          className='w-44'
          size='sm'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {probes.map((probe) => (
            <SelectItem key={probe} value={probe}>
              {t(PROBE_LABELS[probe])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isTime && (
        <div className='w-56 max-w-full min-w-0'>
          <Combobox
            aria-label={t('Timezone')}
            aria-invalid={props.invalidTimezone || undefined}
            options={zones}
            value={props.timezone}
            allowCustomValue
            onValueChange={(timezone) =>
              timezone !== null && props.onChange(props.probe, timezone)
            }
            className='w-full'
          />
        </div>
      )}
    </>
  )
}

/** String drafts keep incomplete bounds visible instead of silently changing them to zero. */
export function BillingConditionValueInput(props: {
  value: string
  onChange: (value: string) => void
  label?: string
  invalid?: boolean
  normalizeNumberDrafts?: boolean
  probe?: VisualComparison['probe']
}) {
  const { t, i18n } = useTranslation()
  // 星期是枚举，永远用下拉（0~6 = 周日~周六）；数值草稿（normalizeNumberDrafts）只对
  // hour/minute/month/day 这类数字探针有意义 —— 2026-09-13 maintainer指出乘数区的星期范围
  // 显示成了原始数字「1 至 6」。原先这里多一个 `!normalizeNumberDrafts` 条件，导致
  // 乘数区（传了 normalizeNumberDrafts）落回数字输入框。
  if (
    props.probe === 'weekday' &&
    (props.value === '' || /^[0-6]$/.test(props.value))
  ) {
    const formatter = new Intl.DateTimeFormat(
      i18n.language === 'zhCN' ? 'zh-CN' : i18n.language,
      { weekday: 'long', timeZone: 'UTC' }
    )
    const days = Array.from({ length: 7 }, (_, day) => ({
      value: String(day),
      label: formatter.format(new Date(Date.UTC(2026, 0, 4 + day))),
    }))
    return (
      <Select
        items={days}
        value={props.value}
        onValueChange={(value) => value !== null && props.onChange(value)}
      >
        <SelectTrigger
          size='sm'
          className='w-32'
          aria-label={props.label ?? t('Condition value')}
          aria-invalid={props.invalid || undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {days.map((day) => (
            <SelectItem key={day.value} value={day.value}>
              {day.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (props.normalizeNumberDrafts) {
    return (
      <DraftNumberInput
        aria-label={props.label ?? t('Condition value')}
        value={props.value}
        onValueChange={(value) => props.onChange(String(value))}
        className='w-24'
      />
    )
  }
  return (
    <Input
      type='text'
      inputMode='numeric'
      aria-label={props.label ?? t('Condition value')}
      aria-invalid={props.invalid || undefined}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      className='w-24'
    />
  )
}

export function BillingTimeRangeFields(props: {
  start: string
  end: string
  startOperator?: ReactNode
  endOperator?: ReactNode
  invalidStart?: boolean
  invalidEnd?: boolean
  normalizeNumberDrafts?: boolean
  probe?: VisualComparison['probe']
  onChange: (start: string, end: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      {props.startOperator}
      <BillingConditionValueInput
        label={props.probe === 'weekday' ? t('Start weekday') : t('Start')}
        probe={props.probe}
        normalizeNumberDrafts={props.normalizeNumberDrafts}
        invalid={props.invalidStart}
        value={props.start}
        onChange={(start) => props.onChange(start, props.end)}
      />
      <span className='text-muted-foreground text-xs'>{t('to')}</span>
      {props.endOperator}
      <BillingConditionValueInput
        label={props.probe === 'weekday' ? t('End weekday') : t('End')}
        probe={props.probe}
        normalizeNumberDrafts={props.normalizeNumberDrafts}
        invalid={props.invalidEnd}
        value={props.end}
        onChange={(end) => props.onChange(props.start, end)}
      />
    </>
  )
}
