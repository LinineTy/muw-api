// @muw-owned
import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type ToggleStateProps = {
  label: string
  icon?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

// TogglePill 桌面端开关 pill（hidden sm:flex）：icon + Label + Switch。
// 与 ToggleMenuItem 配对使用，同一开关状态在移动端收进 "More Actions" 下拉。
export function TogglePill({ id, label, icon, checked, onCheckedChange }: ToggleStateProps & { id: string }) {
  return (
    <div className='hidden items-center gap-2 rounded-md border px-3 py-1.5 sm:flex'>
      {icon}
      <Label htmlFor={id} className='cursor-pointer text-sm'>
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

// ToggleMenuItem 移动端开关项（sm:hidden），需放在 DropdownMenuContent 内，与 TogglePill
// 共用同一状态。样式照渠道页 "More Actions" 下拉里的开关项。
export function ToggleMenuItem({ label, icon, checked, onCheckedChange }: ToggleStateProps) {
  return (
    <DropdownMenuCheckboxItem className='sm:hidden' checked={checked} onCheckedChange={onCheckedChange}>
      {icon && <span className='mr-2'>{icon}</span>}
      {label}
    </DropdownMenuCheckboxItem>
  )
}

// MobileToggleMenu 移动端 "More Actions" 溢出菜单容器（sm:hidden）：没有现成溢出菜单的
// 页面用它统一装 ToggleMenuItem，保持与渠道页一致的移动端收进 "..." 行为。
export function MobileToggleMenu({ children }: { children: ReactNode }) {
  return (
    <div className='sm:hidden'>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant='outline' size='sm' />}>
          <MoreHorizontal className='size-4' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='min-w-56'>
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
