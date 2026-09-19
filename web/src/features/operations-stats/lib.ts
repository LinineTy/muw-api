// @muw-owned
import type { OperationsTrendRow } from './types'

/** day_idx（时区平移后的 epoch 天序号）→ 本地日期字符串。 */
export function dayIdxToDate(dayIdx: number, tzOffsetSeconds: number): string {
  const d = new Date((dayIdx * 86400 - tzOffsetSeconds) * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 缺口补零：把稀疏的按天聚合补成连续日期序列，返回给图表用。 */
export function fillTrendDays(
  rows: OperationsTrendRow[],
  days: number,
  tzOffsetSeconds: number
): { dates: string[]; series: OperationsTrendRow[] } {
  const byDay = new Map<number, OperationsTrendRow>()
  rows.forEach((r) => byDay.set(r.day_idx, r))

  const todayIdx = Math.floor((Date.now() / 1000 + tzOffsetSeconds) / 86400)
  const startIdx = todayIdx - days + 1
  const series: OperationsTrendRow[] = []
  const dates: string[] = []
  for (let i = startIdx; i <= todayIdx; i++) {
    const row = byDay.get(i) ?? {
      day_idx: i,
      new_users: 0,
      active_users: 0,
      requests: 0,
      quota: 0,
    }
    dates.push(dayIdxToDate(i, tzOffsetSeconds))
    series.push(row)
  }
  return { dates, series }
}

const PIE_COLORS = [
  '#5470c6',
  '#91cc75',
  '#fac858',
  '#ee6666',
  '#73c0de',
  '#3ba272',
  '#fc8452',
  '#9a60b4',
]

/** 环形图 spec（注册来源 / 分组分布共用）。
 * ⚠️ 写法必须照 VChart 2.x 的规矩（2026-09-19 踩坑修正，此前饼图整块不渲染）：
 *  - data 要 `[{ id, values }]`，直接给裸数组 `[...]` 画不出来（折线那类用 `{ values }` 是对的）
 *  - 扇区配色走顶层 `color: { type: 'ordinal', range }`，
 *    写在数据项的 `style.fill` 上不生效
 */
export function buildPieSpec(
  data: { name: string; value: number }[],
  title: string
): object {
  return {
    type: 'pie',
    title: { visible: true, text: title, textStyle: { fontSize: 13 } },
    data: [{ id: 'pieData', values: data }],
    outerRadius: 0.8,
    innerRadius: 0.5,
    padAngle: 0.6,
    valueField: 'value',
    categoryField: 'name',
    legends: { visible: true, orient: 'right' },
    label: { visible: false },
    color: { type: 'ordinal', range: PIE_COLORS },
  }
}

/** 多序列折线 spec（新增/活跃用户趋势）。 */
export function buildTrendLineSpec(
  dates: string[],
  series: { name: string; values: number[]; color: string }[],
  title: string
): object {
  return {
    type: 'line',
    title: { text: title, textStyle: { fontSize: 13 } },
    data: { values: buildLineValues(dates, series) },
    xField: 'date',
    yField: 'value',
    seriesField: 'name',
    legends: { visible: true },
    point: { style: { size: 4 } },
    line: { style: { lineWidth: 2 } },
    color: series.map((s) => s.color),
  }
}

function buildLineValues(
  dates: string[],
  series: { name: string; values: number[] }[]
): { date: string; value: number; name: string }[] {
  const out: { date: string; value: number; name: string }[] = []
  dates.forEach((date, i) => {
    series.forEach((s) => {
      out.push({ date, value: s.values[i] ?? 0, name: s.name })
    })
  })
  return out
}
