// @muw-owned
/**
 * 从壁纸图里取「主色相」，供琉璃主题把按钮色（--primary/--ring 的色相）跟着壁纸走。
 *
 * 只取**色相**，不取亮度彩度：预设自己的 L/C/透明度保持不变，按钮上的白字
 * 对比度就不会因为换壁纸而翻车（这也是不直接拿"平均色"铺上去的原因）。
 *
 * 取色是**加权圆形均值**：
 * - 逐像素转 HSL，丢掉近灰（彩度低）、近黑近白（明度极端）的像素——照片里
 *   大量灰阶/暗部会把色相均值拉偏；
 * - 权重取「彩度 × 中明度偏好」，让鲜艳且不刺眼的区域说话；
 * - 色相是环形的（0° 和 359° 相邻），所以用 cos/sin 分量求均值再 atan2 回角度，
 *   直接算术平均会在红色附近翻车。
 *
 * 取不到颜色（灰图/纯黑白/加载失败/画布被跨域污染）时返回 null，
 * 调用方据此回落到预设默认色相。
 */

/** 缩样尺寸：够统计又不拖慢，64×64 = 4096 个采样点 */
const SAMPLE_SIZE = 64

/** 彩度下限（0~255 的 max-min）：低于此值算灰阶，不参与色相统计 */
const MIN_CHROMA = 24

/** 明度极值：太暗（阴影）和太亮（高光）都不代表壁纸主色 */
const MIN_LIGHTNESS = 0.12
const MAX_LIGHTNESS = 0.92

/** 同一张图只算一次 */
const hueCache = new Map<string, Promise<number | null>>()

/** RGB → [hue(0~360), saturation(0~1), lightness(0~1)] */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) return [0, 0, lightness]

  let hue: number
  if (max === rn) {
    hue = ((gn - bn) / delta) % 6
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2
  } else {
    hue = (rn - gn) / delta + 4
  }
  hue *= 60
  if (hue < 0) hue += 360

  const saturation = delta / (1 - Math.abs(2 * lightness - 1) || 1)
  return [hue, saturation, lightness]
}

/** 读像素并算色相；任何一步失败都返回 null（画布被污染时 getImageData 会抛） */
function hueFromImage(img: HTMLImageElement): number | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  } catch {
    // 跨域图未带 CORS 头 → 画布被污染，读不到像素
    return null
  }

  let sumX = 0
  let sumY = 0
  let totalWeight = 0

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha < 128) continue // 透明像素不参与
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (chroma < MIN_CHROMA) continue

    const [hue, , lightness] = rgbToHsl(r, g, b)
    if (lightness < MIN_LIGHTNESS || lightness > MAX_LIGHTNESS) continue

    // 中明度偏好：越靠近 0.5 权重越高（阴影和高光都不是"主色"）
    const midTone = 1 - Math.abs(lightness - 0.5) * 1.4
    const weight = chroma * Math.max(0.05, midTone)

    const rad = (hue * Math.PI) / 180
    sumX += Math.cos(rad) * weight
    sumY += Math.sin(rad) * weight
    totalWeight += weight
  }

  if (totalWeight <= 0) return null
  let hue = (Math.atan2(sumY, sumX) * 180) / Math.PI
  if (hue < 0) hue += 360
  return hue
}

/** 取壁纸主色相（0~360）；取不到返回 null。同 URL 只算一次。 */
export function extractWallpaperHue(url: string): Promise<number | null> {
  const cached = hueCache.get(url)
  if (cached) return cached

  const task = new Promise<number | null>((resolve) => {
    const img = new Image()
    // 内置图床是同源的；带上 anonymous 是为了将来换成带 CORS 的外链也能读像素，
    // 真读到不（未带 CORS 的外链）由 getImageData 抛错兜住，回落默认色相。
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        resolve(hueFromImage(img))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  }).catch(() => null)

  hueCache.set(url, task)
  return task
}
