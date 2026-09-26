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
import { Main } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { CloudSpaceCard } from '@/features/space/components/cloud-space-card'
import { SpaceStorageCard } from '@/features/space/components/space-storage-card'
import { useSpaceInfo } from '@/features/space/hooks/use-space-info'
import { useAuthStore } from '@/stores/auth-store'

import { CreditScoreCard } from './components/credit-score-card'
import { GroupPinCard } from './components/group-pin-card'
import { ProfileHeader } from './components/profile-header'
import { ProfileSettingsCard } from './components/profile-settings-card'
import { SidebarModulesCard } from './components/sidebar-modules-card'
import { useProfile } from './hooks'

export function Profile() {
  const { profile, loading, refreshProfile } = useProfile()
  const { space, refresh: refreshSpace } = useSpaceInfo()
  const permissions = useAuthStore((s) => s.auth.user?.permissions)

  const canConfigureSidebar = permissions?.sidebar_settings !== false

  return (
    <Main>
      <div className='min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-6'>
        <CardStaggerContainer className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-6'>
          <CardStaggerItem>
            <ProfileHeader
              profile={profile}
              loading={loading}
              onProfileUpdate={refreshProfile}
            />
          </CardStaggerItem>

          <CardStaggerItem>
            {/* 双列主侧：左=云空间/设置/边栏模块，右=分组与固定/风控分/容量。
                分组信息单一来源在右栏分组卡，header 不再重复展示组/钉。
                云空间在最上：账号设置类卡片是低频入口。 */}
            <div className='grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start'>
              <div className='space-y-4 sm:space-y-6'>
                <CloudSpaceCard space={space} onChanged={refreshSpace} />
                <ProfileSettingsCard
                  profile={profile}
                  loading={loading}
                  onProfileUpdate={refreshProfile}
                />
                {canConfigureSidebar && <SidebarModulesCard />}
              </div>

              <div className='space-y-4 sm:space-y-6 xl:sticky xl:top-6'>
                <GroupPinCard profile={profile} loading={loading} />
                <CreditScoreCard />
                <SpaceStorageCard space={space} onPurchased={refreshSpace} />
              </div>
            </div>
          </CardStaggerItem>
        </CardStaggerContainer>
      </div>
    </Main>
  )
}
