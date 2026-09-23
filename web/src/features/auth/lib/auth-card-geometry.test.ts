// @muw-owned
import { describe, expect, it } from 'vitest'

import { BADGE, BADGE_CLEARANCE, CARD_FOOT } from './auth-card-geometry'

describe('auth card geometry', () => {
  // 角标向上侵入主卡，所以内容块下方必须留够空档：内容间距 + 底部保留区 ≥ 侵入高度。
  // 这条不变式一旦不成立，右下角标就会压到主按钮上（2026-09-23 踩过）。
  it('keeps card content above the badge intrusion', () => {
    expect(CARD_FOOT.gap + CARD_FOOT.height).toBeGreaterThanOrEqual(
      BADGE_CLEARANCE
    )
  })

  it('badge protrudes as designed', () => {
    expect(BADGE.width).toBe(130)
    expect(BADGE.height).toBe(48)
    expect(BADGE.outRight).toBe(8)
    expect(BADGE.outBottom).toBe(10)
  })
})
