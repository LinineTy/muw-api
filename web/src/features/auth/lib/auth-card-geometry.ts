// @muw-owned
/**
 * 认证页卡壳的几何常量（角标 = 5×3 格：列 26px / 行 16px ⇒ 130×48，
 * 外露主卡右侧 8px、下方 10px）。改数值请连同 AuthCard 的文字带让位一起改。
 */
export const BADGE = {
  width: 130,
  height: 48,
  outRight: 8,
  outBottom: 10,
  gap: 14,
} as const

/**
 * 主卡底部保留区（设计稿 .card-foot）：32px 里含 12px 下留白，
 * 文字中心因此落在卡片底边上方 22px = 小卡 1/2 行分界线。
 */
export const CARD_FOOT = {
  height: 32,
  paddingBottom: 12,
  /** 与上方内容块之间的间距（设计稿主卡 grid gap） */
  gap: 14,
} as const

/**
 * 主卡底部保留区的总高（含与上方内容之间的间距）：gap 14 + 文字带 32 = 46。
 * ⚠️ **没有底部入口时也要留这么多**：角标与最后一个内容块之间的视觉间距才与有入口时一致
 * （46 − BADGE_CLEARANCE 38 = 8px）。只留 BADGE_CLEARANCE(38) 会让角标正好贴住内容块
 * （2026-09-24 实测：无 OAuth 的登录页角标贴住主按钮）。
 */
export const CARD_FOOT_RESERVED = CARD_FOOT.gap + CARD_FOOT.height

/**
 * 角标向上侵入主卡的高度。
 * ⚠️ 不变式：主卡内容块必须整块留在卡片底边上方 `BADGE_CLEARANCE` 之内，
 * 否则角标会压到内容（比如 54px 的主按钮）上。
 * 设计稿靠「内容 gap 14 + 底部保留区 32 = 46 ≥ 38」满足它。
 */
export const BADGE_CLEARANCE = BADGE.height - BADGE.outBottom
