// @muw-owned
/**
 * OS 壳 · 小鲸鱼挂件的台词池（**只有嘴，没有数据**）
 *
 * 出处：MeteorNOX/DeepSeek-Balance-Whale-Widget（MIT）的随机台词组。
 * 搬过来时**砍掉了原版权重 45% 的「当前时间段 + 今日已用」那一组** —— maintainer 2026-09-14：
 * 「我只要那个说骚话的，数据的不要」。剩下各组的**权重比例保持原样**（7 / 7 / 10 / 3 / 1），
 * 所以气泡里出现的一定是台词或那段动图，不会再冒出余额、时段之类的数字。
 *
 * 台词只改了一处：原版「你目录里的dsh是什么...大烧货吗...?」是 DSH 语境的笑点，
 * 本仓没有 dsh 目录，改写为站点语境（key 库）；其余台词一字未动。
 */
export type WhaleLineStyle = 'A' | 'B'

export interface WhaleLine {
  /** 台词正文 */
  t: string
  /** A = 小字（label 档），B = 大字（amount 档），与原版 BUBBLE_STYLE_CLASS 对应 */
  s: WhaleLineStyle
  /** 长台词要换行（原版 singleCenter 的 wrap 参数） */
  w?: boolean
}

/**
 * 气泡内容：三行槽位（与原版一致，单行台词放中间槽 = 视觉居中），
 * 或那段 rua 动图。
 */
export type WhaleBubbleContent =
  | { kind: 'gif' }
  | { kind: 'text'; rows: (WhaleLine | null)[] }

/** 「好模型... ↓」组 */
export const WHALE_PRAISE_LINES = ['好模型... ↓', '好女孩...↓'] as const

/** 卖萌吐槽组 */
export const WHALE_WHINE_LINES = [
  '不知道用户有什么用，先赶走吧~',
  '我...我...我也要挣钱吗？',
  '我去吃饭啦，测完叫我',
  '压力一只蓝色大肥鱼？！',
  'DeepSleep...',
  '坏了...用户彻底怒了！',
] as const

/** 骚话组（原版里带 dsh 目录梗的那条已改写为站点语境） */
export const WHALE_SNARK_LINES = [
  '你库里那堆 key 是什么...大烧货吗...?',
  '恭喜你实现token自由！token全跑了！',
  '真当我是便宜货啊...',
] as const

/** 单独一组的那句（原版权重 1，最容易漏掉的一句） */
export const WHALE_SOLO_LINES = ['哦鲸鲸... '] as const

/** 动图加载不出来时的降级台词（原版同款） */
export const WHALE_GIF_FAIL_LINES = [
  'gif 加载失败了...',
  '今天没有动图给你看~',
  '呜呜 动图不见了...',
] as const

function pickOne<T>(pool: readonly T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)]
}

/** 单行居中（中间槽位），与原版 singleCenter 等价 */
function center(line: WhaleLine): WhaleBubbleContent {
  return { kind: 'text', rows: [null, line, null] }
}

/**
 * 台词组与权重（**顺序与权重都照搬原版**，只是删掉了数据那组）。
 * 加/减台词只改这里，别在组件里再写一份清单。
 */
const WHALE_GROUPS: {
  w: number
  pick: (rng: () => number) => WhaleBubbleContent
}[] = [
  {
    w: 7,
    pick: (rng) => center({ t: pickOne(WHALE_PRAISE_LINES, rng), s: 'B' }),
  },
  {
    w: 7,
    pick: (rng) =>
      center({ t: pickOne(WHALE_WHINE_LINES, rng), s: 'A', w: true }),
  },
  { w: 10, pick: () => ({ kind: 'gif' }) },
  {
    w: 3,
    pick: (rng) =>
      center({ t: pickOne(WHALE_SNARK_LINES, rng), s: 'A', w: true }),
  },
  { w: 1, pick: () => center({ t: WHALE_SOLO_LINES[0], s: 'B' }) },
]

/** 按权重抽一段气泡内容（rng 可注入，便于测试） */
export function pickWhaleBubble(
  rng: () => number = Math.random
): WhaleBubbleContent {
  let total = 0
  for (const group of WHALE_GROUPS) total += group.w
  let r = rng() * total
  for (const group of WHALE_GROUPS) {
    r -= group.w
    if (r < 0) return group.pick(rng)
  }
  return WHALE_GROUPS[WHALE_GROUPS.length - 1].pick(rng)
}

/** 动图挂了以后显示的降级台词 */
export function pickWhaleGifFailBubble(
  rng: () => number = Math.random
): WhaleBubbleContent {
  return center({ t: pickOne(WHALE_GIF_FAIL_LINES, rng), s: 'A', w: true })
}
