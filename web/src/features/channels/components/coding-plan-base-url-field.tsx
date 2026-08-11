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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseFormReturn } from 'react-hook-form'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  CHANNEL_TYPE_CODING_PLAN_SUGGEST,
  CODING_PLAN_BASE_URL_PRESETS,
  CODING_PLAN_PROVIDER_DISABLED,
  CODING_PLAN_PROVIDER_OPTIONS,
} from '../constants'
import type { ChannelFormValues } from '../lib'

type CodingPlanBaseUrlFieldProps = {
  form: UseFormReturn<ChannelFormValues>
  channelType: number
}

/**
 * 编码套餐可用的渠道类型(Anthropic/智谱v4/Moonshot/MiniMax)的 base_url 选择器,与火山渠道同款:
 * 下拉直接展示真实地址——传统 API 端点 + 各厂商编码套餐专用端点(选中存符号键,
 * 后端 ChannelSpecialBases 解析成真实端点;Anthropic 类型则直接存 Anthropic 兼容端点),
 * 另加「手动/自定义」条目回退到自由填 URL 并配置额外鉴权密钥(plan key),覆盖走聚合代理等
 * 无法自动识别的场景。选中预设时同步写入套餐厂商(coding_plan_provider),保证余量监控可用。
 */
export function CodingPlanBaseUrlField({
  form,
  channelType,
}: CodingPlanBaseUrlFieldProps) {
  const { t } = useTranslation()
  const baseUrl = form.watch('base_url') ?? ''
  const codingPlanProvider = form.watch('coding_plan_provider') ?? ''
  const presets = CODING_PLAN_BASE_URL_PRESETS[channelType] ?? []
  // 手动/自定义是独立状态,不靠 base_url 为空来区分——空字符串同时是"新渠道走内置默认"。
  // 点「手动/自定义」置 true;base_url 非空时按是否落在预设里自动同步(编辑已有自定义
  // URL 渠道、类型切换都会经此校正)。切换类型且 base_url 为空时回到预设选择态。
  const [manualMode, setManualMode] = useState(false)
  const prevChannelTypeRef = useRef(channelType)
  // 用户显式点过「手动/自定义」:即使填的 URL 恰好命中预设(如完整 Anthropic 套餐地址)
  // 也保持手动,不再被 URL 自动打回预设(否则选自定义填同款地址仍会被当套餐绑定)。
  const manualChosenRef = useRef(false)
  useEffect(() => {
    const prevType = prevChannelTypeRef.current
    prevChannelTypeRef.current = channelType
    if (prevType !== channelType) {
      // 换类型:重置显式选择,空 base_url 回到预设选择态。
      manualChosenRef.current = false
      if (baseUrl === '') {
        setManualMode(false)
        return
      }
    }
    // 用户显式选过手动:保持手动,不再按 URL 是否命中预设回退。
    if (manualChosenRef.current) return
    // 显式关闭监控("none")= 手动/自定义渠道(默认),重新打开表单也保持手动展示,
    // 避免命中预设的套餐地址被当成预设端点回显。
    if (codingPlanProvider === CODING_PLAN_PROVIDER_DISABLED) {
      setManualMode(true)
      return
    }
    if (baseUrl === '') return
    const ps = CODING_PLAN_BASE_URL_PRESETS[channelType] ?? []
    setManualMode(!ps.some((preset) => preset.value === baseUrl))
  }, [baseUrl, codingPlanProvider, channelType])

  const selected = presets.find((preset) => preset.value === baseUrl)
  // 手动模式优先;否则选中预设,或新渠道(空 base_url)按首个传统端点展示。
  let displayValue: string
  if (manualMode) {
    displayValue = 'manual'
  } else if (selected) {
    displayValue = selected.value
  } else {
    displayValue = presets[0]?.value ?? 'manual'
  }

  return (
    <>
      <FormField
        control={form.control}
        name='base_url'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('API Base URL *')}</FormLabel>
            <Select
              items={[
                ...presets.map((preset) => ({
                  value: preset.value,
                  label: t(preset.display),
                })),
                { value: 'manual', label: t('Manual / Custom') },
              ]}
              onValueChange={(value) => {
                if (value === 'manual') {
                  // 手动/自定义:完全自由填写,默认不启用余量监控(显式关闭,即使填的
                  // 地址是套餐端点也不再自动绑定);需要监控时再选厂商或「自动识别」。
                  // 显式选手动后保持手动(manualChosenRef),不再被 URL 命中预设打回。
                  manualChosenRef.current = true
                  setManualMode(true)
                  field.onChange('')
                  form.setValue(
                    'coding_plan_provider',
                    CODING_PLAN_PROVIDER_DISABLED,
                    {
                      shouldDirty: true,
                    }
                  )
                } else {
                  manualChosenRef.current = false
                  setManualMode(false)
                  field.onChange(value)
                  const preset = presets.find((item) => item.value === value)
                  // 选中预设:同步厂商,传统端点(无 provider)清空 = 不启用余量监控。
                  form.setValue('coding_plan_provider', preset?.provider ?? '', {
                    shouldDirty: true,
                  })
                }
              }}
              value={displayValue}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent
                alignItemWithTrigger={false}
                /* 弹层默认宽度跟随触发按钮(火山同款),但套餐地址比传统端点长、
                   还要放「编码套餐」角标。最小宽度要覆盖最长的
                   https://open.bigmodel.cn/api/anthropic/v1/messages + 角标 + 选中勾的预留区,
                   否则角标会被裁掉或与右侧 ✅ 重叠。 */
                className='min-w-[36rem]'
              >
                <SelectGroup>
                  {presets.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {t(preset.display)}
                      {preset.plan && (
                        <Badge
                          variant='warning'
                          className='pointer-events-none shrink-0'
                        >
                          {t('Coding Plan')}
                        </Badge>
                      )}
                    </SelectItem>
                  ))}
                  <SelectItem value='manual'>{t('Manual / Custom')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FormDescription>
              {t(
                'Choose the standard API endpoint, or the coding-plan endpoint for plan subscribers. Manual lets you enter a custom URL.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {manualMode && (
        <ManualCodingPlanConfig form={form} channelType={channelType} />
      )}
    </>
  )
}

function ManualCodingPlanConfig({
  form,
  channelType,
}: CodingPlanBaseUrlFieldProps) {
  const { t } = useTranslation()

  // 手动模式:provider 按渠道类型过滤相关厂商(智谱→zhipu/zhipu_en 等);
  // 聚合代理渠道类型(如 OpenAI/Anthropic)无映射,则列出全部厂商供手动选。
  const suggested = CHANNEL_TYPE_CODING_PLAN_SUGGEST[channelType]
  const providerOptions = suggested
    ? CODING_PLAN_PROVIDER_OPTIONS.filter(
        (option) =>
          option.value === suggested || option.value === `${suggested}_en`
      )
    : CODING_PLAN_PROVIDER_OPTIONS

  return (
    <>
      <FormField
        control={form.control}
        name='base_url'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Base URL')}</FormLabel>
            <FormControl>
              <Input
                placeholder='https://...'
                autoComplete='off'
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name='coding_plan_provider'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Coding plan provider')}</FormLabel>
            <FormControl>
              <Select
                value={field.value || 'auto'}
                onValueChange={(value) =>
                  field.onChange(value === 'auto' ? '' : value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CODING_PLAN_PROVIDER_DISABLED}>
                    {t('Disable quota monitoring')}
                  </SelectItem>
                  <SelectItem value='auto'>{t('Auto detect')}</SelectItem>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormDescription>
              {t(
                'Manual channels are not monitored by default. Pick a provider to monitor its coding-plan quota, or keep it disabled.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name='coding_plan_key'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Coding plan key')}</FormLabel>
            <div className='grid gap-2 sm:grid-cols-[1fr_auto]'>
              <FormControl>
                <Input
                  type='password'
                  autoComplete='off'
                  placeholder={t('Leave empty to use the channel key')}
                  {...field}
                />
              </FormControl>
              {(form.watch('coding_plan_key_masked') ||
                form.watch('coding_plan_key')) && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='self-end'
                  onClick={() => {
                    form.setValue('coding_plan_key', '')
                    form.setValue('coding_plan_key_clear', true)
                  }}
                >
                  {t('Clear stored key')}
                </Button>
              )}
            </div>
            <FormDescription>
              {form.watch('coding_plan_key_masked')
                ? t(
                    'A coding-plan key is stored. Leave empty to keep it, or clear it to fall back to the channel key.'
                  )
                : t(
                    'Only needed when the channel key is not the coding-plan key (e.g. behind an aggregator proxy).'
                  )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}
