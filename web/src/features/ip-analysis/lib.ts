// @muw-owned
/** Unix 秒 → 本地可读时间（简短格式）。 */
export function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return '-'
  const d = new Date(unixSeconds * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

const CHART_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272']

/** day_idx（时区平移后的 epoch 天序号）→ 本地日期字符串。 */
export function dayIdxToDate(dayIdx: number, tzOffsetSeconds: number): string {
  const d = new Date((dayIdx * 86400 - tzOffsetSeconds) * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 单序列柱状图 spec（用户 IP 数分布）。
 * ⚠️ 写法必须照 VChart 2.x 的规矩：data 用 `[{ id, values }]` 包裹，
 * 配色走顶层 `color` —— 直接在 data 里给裸数组/写 style.fill 会整块画不出来
 * （2026-09-19 饼图不渲染的教训，诊断顺序见 the chart rendering notes）。
 */
export function buildBarSpec(
  categories: string[],
  values: number[],
  title: string,
  seriesName: string
): object {
  return {
    type: 'bar',
    title: { visible: true, text: title, textStyle: { fontSize: 13 } },
    data: [
      {
        id: 'ipDistData',
        values: categories.map((c, i) => ({
          category: c,
          value: values[i] ?? 0,
        })),
      },
    ],
    xField: 'category',
    yField: 'value',
    bar: { style: { cornerRadius: 4 } },
    label: { visible: true },
    legends: { visible: false },
    color: { type: 'ordinal', range: [CHART_COLORS[0]] },
    tooltip: { mark: { content: [{ key: seriesName, value: 'value' }] } },
  }
}

/** 单序列折线 spec（每日独立 IP 数趋势）。 */
export function buildTrendLineSpec(
  dates: string[],
  values: number[],
  title: string
): object {
  return {
    type: 'line',
    title: { visible: true, text: title, textStyle: { fontSize: 13 } },
    data: [
      {
        id: 'ipTrendData',
        values: dates.map((d, i) => ({ date: d, value: values[i] ?? 0 })),
      },
    ],
    xField: 'date',
    yField: 'value',
    point: { style: { size: 4 } },
    line: { style: { lineWidth: 2 } },
    legends: { visible: false },
    color: { type: 'ordinal', range: [CHART_COLORS[0]] },
  }
}
