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
