// @muw-owned
/**
 * 认证页的尺寸常量，逐条对齐设计稿（`/设计稿/登录页重构/index.html`）：
 * 主按钮与输入框同高 46px / 圆角 12（maintainer 2026-09-23 定：实色按钮全部缩到和输入框一样大，
 * 覆盖设计稿原来的 54px）；输入框 46px / 14.5px 字 / 圆角 12；
 * 次级文字 12.5px、提示 12px。改这些值之前先改设计稿，别在这里单独飘。
 */
export const AUTH_PRIMARY_BUTTON =
  'h-[46px] w-full justify-center gap-2.5 rounded-xl text-base font-semibold'

export const AUTH_INPUT =
  // Input 组件自带 text-base + md:text-sm，要覆盖得把断点变体也写上
  'h-[46px] rounded-xl text-[14.5px] md:text-[14.5px]'

/** 卡内次级文字（底部次要入口、忘记密码） */
export const AUTH_MINOR_TEXT = 'text-[12.5px]'

/** 卡内法务勾选行 */
export const AUTH_LEGAL_TEXT = 'text-[12.5px]'

/** 禁用法务提示 */
export const AUTH_HINT_TEXT = 'text-destructive text-xs'
