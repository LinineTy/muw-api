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
