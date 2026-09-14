// @muw-owned
import { Fish } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

import { useOsBallStore } from './os-ball-store'
import { FAB_BALL_SM, FAB_ICON_SM } from './os-ball-style'
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

function closeNavCard() {
  // 与竖条其他球一致：点开自己的弹层前先把开始面板收掉
  useOsBallStore.getState().close()
}

/** Base UI 的 Slider 回调可能给数组（只读数组），这里统一取第一个值 */
function firstValue(value: number | readonly number[]): number {
  return Array.isArray(value) ? (value[0] as number) : (value as number)
}

/** 弹层里的一行：标签 + 控件 + 当前值 */
function WhaleRow({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: React.ReactNode
}) {
  return (
    <div className='flex items-center gap-2 px-2 py-1.5'>
      <span className='text-muted-foreground w-10 shrink-0 text-xs'>
        {label}
      </span>
      {children}
      <span className='w-9 shrink-0 text-right text-xs tabular-nums'>
        {value}
      </span>
    </div>
  )
}

/**
 * OS 桌面 · 竖条「鲸鱼」球（挂件的唯一设置入口）
 *
 * maintainer 2026-09-14：「那个调节的和小组件一样放边栏里」—— 于是原版挂在鲸鱼右上角的
 * 汉堡菜单整个不要了，只把**大小 / 音效开关 / 音量**三行挪到竖条球里，与「组件」球同形态。
 *
 * 图标用 lucide 的 `Fish`：lucide 1.25.0 里没有鲸鱼图标（只有 fish 系列），
 * 手画的线条鲸鱼maintainer看着丑（"好丑，类似鱼的图标就行了，最好是原生就有的"），
 * 直接用原生 Fish。
 */
export function OsWhaleBall({ side }: { side: 'left' | 'right' }) {
  const { t } = useTranslation()
  const scale = useOsWhaleStore((state) => state.scale)
  const soundOn = useOsWhaleStore((state) => state.soundOn)
  const soundSet = useOsWhaleStore((state) => state.soundSet)
  const volume = useOsWhaleStore((state) => state.volume)
  const setScale = useOsWhaleStore((state) => state.setScale)
  const setSoundOn = useOsWhaleStore((state) => state.setSoundOn)
  const setSoundSet = useOsWhaleStore((state) => state.setSoundSet)
  const setVolume = useOsWhaleStore((state) => state.setVolume)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            aria-label={t('Whale')}
            title={t('Whale')}
            onClick={closeNavCard}
            className={FAB_BALL_SM}
          />
        }
      >
        <Fish className={FAB_ICON_SM} aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='center'
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className='z-[80] min-w-56'
      >
        {/* ⚠️ CheckboxItem 必须在 Menu.Group 里（Base UI 的硬要求，见 os-widgets-ball） */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Whale')}</DropdownMenuLabel>

          <WhaleRow label={t('Size')} value={`${scale.toFixed(1)}×`}>
            <Slider
              aria-label={t('Size')}
              className='w-32'
              min={WHALE_MIN_SCALE}
              max={WHALE_MAX_SCALE}
              step={0.1}
              value={[scale]}
              onValueChange={(next) => setScale(firstValue(next))}
            />
          </WhaleRow>

          <DropdownMenuCheckboxItem
            checked={soundOn}
            onCheckedChange={(checked) => setSoundOn(checked)}
          >
            {t('Sound')}
          </DropdownMenuCheckboxItem>

          {/* 音效集：两段式分段控件（沿用价格页 Segment 的写法）。
              ⚠️ 这里必须用普通 button 而不是 Menu.Item —— 后者点一下就关弹层，
              与上面的尺寸滑块一样要"点完菜单不关"（verify_whale.py 有断言）。 */}
          <div className='flex items-center px-2 py-1.5'>
            <div
              role='group'
              aria-label={t('Sound set')}
              data-testid='whale-sound-set'
              className='bg-muted/60 inline-flex h-7 w-full items-center rounded-lg border p-0.5'
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
          </div>

          <WhaleRow label={t('Volume')} value={`${Math.round(volume * 100)}%`}>
            <Slider
              aria-label={t('Volume')}
              className='w-32'
              min={0}
              max={1}
              step={0.05}
              value={[volume]}
              onValueChange={(next) => setVolume(firstValue(next))}
            />
          </WhaleRow>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
