// @muw-owned
// 敏感词导入的解析与"可能过宽"启发式判断。抽成独立模块，便于单元测试。

export interface ParsedSensitiveWords {
  words: string[]
  riskIndices: number[]
}

// isHighRiskWord 判定"匹配面过宽"的词：纯英文短单词（system/error/content…）或
// ≤2 个中文字的短词（信息/内容…）。敏感词是子串匹配，这类词命中面极大、容易误伤。
// 只作"提示"，不硬性排除——有效但短的关键词（如"涉黄"）由用户在预览里自行决定去留。
function isHighRiskWord(word: string): boolean {
  const w = word.trim()
  if (/^[A-Za-z]{1,8}$/.test(w)) return true
  if (/^[一-龥]{1,2}$/.test(w)) return true
  return false
}

// parseSensitiveWords 从原始文本解析敏感词：按行/逗号/分号/顿号拆分，清理空行、注释
// （# 或 // 开头）、行首序号（1. / 一、 / ① / - / •），去重（保留首次出现顺序），
// 同时标注"可能过宽"的高风险词下标。
export function parseSensitiveWords(raw: string): ParsedSensitiveWords {
  const seen = new Set<string>()
  const words: string[] = []
  const riskIndices: number[] = []

  const push = (w: string) => {
    const t = w
      .trim()
      .replace(/^["'“”「]+|["'“”」]+$/g, '')
      .trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    const idx = words.length
    words.push(t)
    if (isHighRiskWord(t)) riskIndices.push(idx)
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine
      .replace(
        /^\s*(?:\d+[.、．]|[一二三四五六七八九十百千]+[.、．]|\(\d+\)|[①-⑩]|[-*•>])\s*/,
        ''
      )
      .trim()
    if (!line) continue
    if (line.startsWith('#') || line.startsWith('//')) continue
    // 同一行可能用逗号/分号/顿号/全角分隔符隔开多个词。
    for (const part of line.split(/[,;、，；]/)) {
      push(part)
    }
  }
  return { words, riskIndices }
}
