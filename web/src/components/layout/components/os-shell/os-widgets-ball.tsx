// @muw-owned
import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { FAB_BALL_SM, FAB_ICON_SM } from './os-ball-style'
import { useOsBallStore } from './os-ball-store'
import { OS_WIDGET_MENU_ITEMS } from './os-widget-registry'
import { useOsWidgetStore } from './os-widget-store'

function closeNavCard() {
  // 与竖条其他球一致：点开自己的弹层前先把开始面板收掉
  useOsBallStore.getState().close()
}

/**
 * OS 桌面 · 竖条"组件"球（插在公告铃铛与第三方接入之间）
 *
 * 回答maintainer 2026-09-12 的"不想要了怎么办"：一个开关面板，勾掉就不显示，
 * 偏好存浏览器本地（见 os-widget-store）。
 *
 * 为什么放竖条而不是另做设置页：竖条的球本来就都是"点开一个弹层"的形态
 * （语言 / 主题 / 快速导航 / 第三方接入），组件开关是同类操作，塞这里零学习成本，
 * 也不用新开一页。列表来自注册表（os-widget-registry）——不手写第二份清单。
 *
 * 公告卡**不在**这个菜单里：它有自己的开关（铃铛球），两处能关同一个东西会让人困惑。
 */
export function OsWidgetsBall({ side }: { side: 'left' | 'right' }) {
  const { t } = useTranslation()
  const hidden = useOsWidgetStore((state) => state.hidden)
  const toggle = useOsWidgetStore((state) => state.toggle)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            aria-label={t('Desktop widgets')}
            title={t('Desktop widgets')}
            onClick={closeNavCard}
            className={FAB_BALL_SM}
          />
        }
      >
        <LayoutGrid className={FAB_ICON_SM} aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='center'
        side={side}
        sideOffset={8}
        className='z-[80] min-w-44'
      >
        {/* ⚠️ 必须包一层 Group：Base UI 的 CheckboxItem 属于"分组内零件"，
            不在 Menu.Group 里会直接抛 production error #31（菜单打不开）*/}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Desktop widgets')}</DropdownMenuLabel>
          {OS_WIDGET_MENU_ITEMS.map((item) => (
            <DropdownMenuCheckboxItem
              key={item.id}
              checked={!hidden[item.id]}
              onCheckedChange={() => toggle(item.id)}
            >
              {t(item.labelKey)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
