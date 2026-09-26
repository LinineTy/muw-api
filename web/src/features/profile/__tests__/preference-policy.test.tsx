// @muw-owned
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ROLE } from '@/lib/roles'

import { ProfileSettingsCard } from '../components/profile-settings-card'
import type { UserProfile } from '../types'

const baseProfile: UserProfile = {
  id: 1,
  username: 'root',
  display_name: 'Root',
  role: ROLE.SUPER_ADMIN,
  group: 'default',
  quota: 1000000,
  used_quota: 0,
  request_count: 0,
  status: 1,
  aff_count: 0,
  aff_quota: 0,
  aff_history_quota: 0,
  created_time: 0,
  // 用户自己存的值：两项都是「关」，用来区分「强制开启」与「禁止修改」。
  setting: JSON.stringify({
    accept_unset_model_ratio_model: false,
    upstream_model_update_notify_enabled: false,
  }),
  preference_policy: {
    force_on: ['accept_unset_model_ratio_model'],
    locked: ['upstream_model_update_notify_enabled'],
  },
}

function renderCard(profile: UserProfile) {
  return render(
    <ProfileSettingsCard
      profile={profile}
      loading={false}
      onProfileUpdate={() => undefined}
    />
  )
}

function openPreferencesTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }))
}

describe('admin preference policy', () => {
  it('强制开启：开关恒为开且不可点，并显示标记', () => {
    renderCard(baseProfile)
    openPreferencesTab()

    const forced = screen.getByRole('switch', {
      name: 'Accept Unpriced Models',
    })
    // 用户存的是 false，但管理员强制开启 ⇒ 界面必须显示为开、且点不动
    expect(forced).toBeChecked()
    expect(forced).toHaveAttribute('data-disabled')
    fireEvent.click(forced)
    expect(forced).toBeChecked()
    expect(screen.getByText('Admin Enforced')).toBeVisible()
  })

  it('禁止修改：开关不可点，但保留用户自己保存的值', () => {
    renderCard(baseProfile)
    openPreferencesTab()

    const locked = screen.getByRole('switch', {
      name: 'Receive Upstream Model Update Notifications',
    })
    expect(locked).not.toBeChecked()
    expect(locked).toHaveAttribute('data-disabled')
    fireEvent.click(locked)
    expect(locked).not.toBeChecked()
    expect(screen.getByText('Locked by Admin')).toBeVisible()
  })

  it('没有下发策略时两项都可自由切换、无标记', () => {
    renderCard({
      ...baseProfile,
      preference_policy: {},
      setting: JSON.stringify({
        accept_unset_model_ratio_model: true,
        upstream_model_update_notify_enabled: true,
      }),
    })
    openPreferencesTab()

    const accept = screen.getByRole('switch', { name: 'Accept Unpriced Models' })
    expect(accept).toBeChecked()
    expect(accept).not.toHaveAttribute('data-disabled')
    fireEvent.click(accept)
    expect(accept).not.toBeChecked()

    expect(
      screen.getByRole('switch', {
        name: 'Receive Upstream Model Update Notifications',
      })
    ).not.toHaveAttribute('data-disabled')
    expect(screen.queryByText('Admin Enforced')).not.toBeInTheDocument()
    expect(screen.queryByText('Locked by Admin')).not.toBeInTheDocument()
  })

  it('普通用户看不到管理员专属偏好项', () => {
    renderCard({ ...baseProfile, role: ROLE.USER, preference_policy: {} })
    openPreferencesTab()

    expect(
      screen.queryByRole('switch', {
        name: 'Receive Upstream Model Update Notifications',
      })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Accept Unpriced Models' })
    ).toBeVisible()
  })
})
