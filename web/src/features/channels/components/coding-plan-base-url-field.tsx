// @muw-owned
import { useEffect, useRef, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { CODING_PLAN_BASE_URL_PRESETS } from '../constants'
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
    if (baseUrl === '') return
    const ps = CODING_PLAN_BASE_URL_PRESETS[channelType] ?? []
    setManualMode(!ps.some((preset) => preset.value === baseUrl))
  }, [baseUrl, channelType])

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
                } else {
                  manualChosenRef.current = false
                  setManualMode(false)
                  field.onChange(value)
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
        <ManualCodingPlanConfig form={form} />
      )}
    </>
  )
}

function ManualCodingPlanConfig({ form }: { form: UseFormReturn<ChannelFormValues> }) {
  const { t } = useTranslation()

  // 手动模式:只填自定义 base_url;套餐厂商/密钥/自动控制都在账户上配置。
  return (
    <>
      <FormField
        control={form.control}
        name='base_url'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Base URL')}</FormLabel>
            <FormControl>
              <Input placeholder='https://...' autoComplete='off' {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* 编码套餐监控（厂商 / 套餐密钥 / 自动控制）已迁到账户，渠道侧不再配置 */}
      <p className='text-muted-foreground text-xs'>
        {t('Coding-plan quota monitoring is configured on the account.')}
      </p>
    </>
  )
}
