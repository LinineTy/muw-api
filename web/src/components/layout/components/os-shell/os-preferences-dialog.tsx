// @muw-owned
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { useOsNoticeStore } from './os-notice-store'
import { OS_WIDGETS } from './os-widget-registry'
import { useOsWidgetStore } from './os-widget-store'
import {
  WHALE_MAX_SCALE,
  WHALE_MIN_SCALE,
  type WhaleSoundSet,
  useOsWhaleStore,
} from './os-whale-store'

/**
 * 音效集选项（label 是 i18n key，也就是英文原句 —— 与项目其它文案一致）。
 * 两套对应上游汉堡菜单「行2 音效」的 select：小黄鸭（Ya1/Ya2）/ 音效 1（D1/D2）。
 */
const SOUND_SET_OPTIONS: { value: WhaleSoundSet; label: string }[] = [
  { value: 'duck', label: 'Rubber duck' },
  { value: 'fx1', label: 'Sound FX 1' },
]

/** Base UI 的 Slider 回调可能给数组（只读数组），这里统一取第一个值 */
function firstValue(value: number | readonly number[]): number {
  return Array.isArray(value) ? (value[0] as number) : (value as number)
}

/** 弹窗里的一行：标签 + 控件 + 当前值 */
function SettingRow({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children: React.ReactNode
}) {
  return (
    <div className='flex items-center justify-between gap-4'>
      <span className='text-sm'>{label}</span>
      <span className='flex items-center gap-3'>
        {children}
        {value ? (
          <span className='text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums'>
            {value}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * OS 桌面壳 · 「偏好设置」弹窗（2026-09-20 maintainer定：组件 + 鲸鱼合并成一个独立弹窗）
 *
 * 原来竖条上是两颗球（组件显隐 / 鲸鱼设置），都是"桌面装饰"的开关，分散在两处。
 * 合并成一颗球 + 一个弹窗后：竖条少一颗球，两个功能在同一个地方定义。
 *
 * 公告卡的开关**也收进来了**：它本来就是个桌面组件（OS_WIDGETS 里的一员），
 * 之前独占一颗铃铛球 —— 那颗铃铛现在让给「消息」入口。
 * 勾选状态仍然读 `os-notice-store.collapsed`（卡上的 × 和这里操作同一个东西）。
 */
export function OsPreferencesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const hidden = useOsWidgetStore((state) => state.hidden)
  const toggleWidget = useOsWidgetStore((state) => state.toggle)
  const noticeCollapsed = useOsNoticeStore((state) => state.collapsed)
  const setNoticeCollapsed = useOsNoticeStore((state) => state.setCollapsed)

  const scale = useOsWhaleStore((state) => state.scale)
  const visible = useOsWhaleStore((state) => state.visible)
  const soundOn = useOsWhaleStore((state) => state.soundOn)
  const soundSet = useOsWhaleStore((state) => state.soundSet)
  const volume = useOsWhaleStore((state) => state.volume)
  const setScale = useOsWhaleStore((state) => state.setScale)
  const setSoundOn = useOsWhaleStore((state) => state.setSoundOn)
  const setSoundSet = useOsWhaleStore((state) => state.setSoundSet)
  const setVisible = useOsWhaleStore((state) => state.setVisible)
  const setVolume = useOsWhaleStore((state) => state.setVolume)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Preferences')}
      contentClassName='sm:max-w-lg'
    >
      <div className='flex flex-col gap-6'>
        {/* 桌面组件：注册表是唯一来源（加/删组件只改 os-widget-registry） */}
        <section className='space-y-2.5'>
          <h3 className='text-sm font-medium'>{t('Desktop widgets')}</h3>
          <div className='grid gap-2 sm:grid-cols-2'>
            {OS_WIDGETS.map((item) => {
              // 公告卡有自己的 store（卡上的 × 也用它），勾选状态取自那里
              const isNotice = item.id === 'announcements'
              const checked = isNotice ? !noticeCollapsed : !hidden[item.id]
              return (
                <label
                  key={item.id}
                  className='flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3'
                >
                  <span className='min-w-0 truncate text-sm'>
                    {t(item.labelKey)}
                  </span>
                  <Switch
                    data-widget-toggle={item.id}
                    checked={checked}
                    onCheckedChange={(next) => {
                      if (isNotice) setNoticeCollapsed(!next)
                      else toggleWidget(item.id)
                    }}
                  />
                </label>
              )
            })}
          </div>
        </section>

        {/* 鲸鱼挂件：原「鲸鱼」球弹层的全部设置，形态换成弹窗里的行 */}
        <section className='space-y-2.5'>
          <h3 className='text-sm font-medium'>{t('Whale')}</h3>
          <div className='flex flex-col gap-3 rounded-lg border p-3'>
            <SettingRow label={t('Show')}>
              <Switch
                data-testid='whale-visible'
                checked={visible}
                onCheckedChange={(checked) => setVisible(checked)}
              />
            </SettingRow>

            <SettingRow label={t('Size')} value={`${scale.toFixed(1)}×`}>
              {/* 宽度给外层 shrink-0 的定宽盒：Slider 自带的 `data-horizontal:w-full`
                  在这条 flex 行里不生效（Base UI 用的是 data-orientation），内联的 w-40
                  会被这一行的 flex 收缩压成 0 —— 滑轨直接看不见（2026-09-20 截图发现）。
                  外层定宽 + shrink-0 = 滑轨宽度不再依赖父级 flex 计算。 */}
              <div className='w-40 shrink-0'>
                <Slider
                  aria-label={t('Size')}
                  className='w-full'
                  min={WHALE_MIN_SCALE}
                  max={WHALE_MAX_SCALE}
                  step={0.1}
                  value={[scale]}
                  onValueChange={(next) => setScale(firstValue(next))}
                />
              </div>
            </SettingRow>

            <SettingRow label={t('Sound')}>
              <Switch
                data-testid='whale-sound'
                checked={soundOn}
                onCheckedChange={(checked) => setSoundOn(checked)}
              />
            </SettingRow>

            {/* 音效集：两段式分段控件（沿用价格页 Segment 的写法） */}
            <SettingRow label={t('Sound set')}>
              <div
                role='group'
                aria-label={t('Sound set')}
                data-testid='whale-sound-set'
                className='bg-muted/60 inline-flex h-7 w-40 items-center rounded-lg border p-0.5'
              >
                {SOUND_SET_OPTIONS.map((option) => {
                  const isActive = soundSet === option.value
                  return (
                    <button
                      key={option.value}
                      type='button'
                      data-value={option.value}
                      aria-pressed={isActive}
                      onClick={() => setSoundSet(option.value)}
                      className={cn(
                        'inline-flex h-full min-w-0 flex-1 items-center justify-center rounded-md px-1 text-xs font-medium transition-all',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <span className='truncate'>{t(option.label)}</span>
                    </button>
                  )
                })}
              </div>
            </SettingRow>

            <SettingRow
              label={t('Volume')}
              value={`${Math.round(volume * 100)}%`}
            >
              <div className='w-40 shrink-0'>
                <Slider
                  aria-label={t('Volume')}
                  className='w-full'
                  min={0}
                  max={1}
                  step={0.05}
                  value={[volume]}
                  onValueChange={(next) => setVolume(firstValue(next))}
                />
              </div>
            </SettingRow>
          </div>
        </section>
      </div>
    </Dialog>
  )
}
