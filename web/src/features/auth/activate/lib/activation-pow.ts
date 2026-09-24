// @muw-owned
/**
 * 激活页人机校验（PoW）：找 nonce 使 sha256("{challenge}:{nonce}") 具有足够的前导零位。
 *
 * 与后端 `model/activation_pow.go` 同款判别，难度由服务端下发（option `PoWChallengeBits`，
 * 默认 18 位 ≈ 26 万次哈希）。它抬高批量试码的算力成本，不构成"证明你是人"——判定自动化
 * 靠激活页的隐形蜜罐字段。
 *
 * 为什么用 node-forge 而不是 crypto.subtle：`crypto.subtle` 只在安全上下文（HTTPS/localhost）
 * 可用，HTTP 站点上直接是 undefined（147 实测），而 forge 是纯 JS、两种环境都能跑，且项目里
 * 已经打包了它（`password-encryption.ts` 在用），不新增依赖。实测约 62.8 万次/秒（i5-1250P）。
 */

/** 每次循环检查取消/上报进度的批大小：够大以摊薄开销，够小以保证响应。 */
export const POW_BATCH_SIZE = 2000

export type PowProgress = {
  hashes: number
  elapsedMs: number
}

export type PowWorkerRequest =
  | { type: 'solve'; challenge: string; bits: number }
  | { type: 'cancel' }

export type PowWorkerResponse =
  | { type: 'progress'; hashes: number; elapsedMs: number }
  | { type: 'done'; nonce: string; hashes: number; elapsedMs: number }
  | { type: 'failed'; message: string }

/** 同步 sha256（十六进制小写），由调用方注入：Worker 里用 forge，测试里可用假实现。 */
export type Sha256Hex = (input: string) => string

/** 统计十六进制摘要的前导零位数（与后端 CountLeadingZeroBits 等价）。 */
export function countLeadingZeroBits(hex: string): number {
  let bits = 0
  for (const char of hex) {
    const nibble = Number.parseInt(char, 16)
    if (Number.isNaN(nibble)) {
      return 0
    }
    if (nibble === 0) {
      bits += 4
      continue
    }
    if (nibble < 2) bits += 3
    else if (nibble < 4) bits += 2
    else if (nibble < 8) bits += 1
    return bits
  }
  return bits
}

/**
 * 期望哈希数 2^bits 的指数分布：用已算次数估个进度给用户看，
 * 封顶 0.98 以免"进度满了却还没过"的观感落差。
 */
export function estimatePowProgress(hashes: number, bits: number): number {
  if (bits <= 0) return 0
  const expected = 2 ** bits
  const done = 1 - Math.exp(-hashes / expected)
  return Math.min(0.98, Math.max(0, done))
}

export function isDecimalNonce(nonce: string): boolean {
  return nonce !== '' && nonce.length <= 20 && /^[0-9]+$/.test(nonce)
}

export type SolveOptions = {
  /** 返回 true 时中止求解（组件卸载/用户取消）。 */
  shouldStop?: () => boolean
  onProgress?: (progress: PowProgress) => void
  /** 进度上报间隔（毫秒）。 */
  reportIntervalMs?: number
}

/**
 * 纯函数形态的求解循环：从 nonce=0 递增试到满足难度为止。
 * 找不到（或中途被取消）返回 null。
 */
export function solveWithSha256(
  sha256: Sha256Hex,
  challenge: string,
  bits: number,
  options: SolveOptions = {}
): { nonce: string; hashes: number; elapsedMs: number } | null {
  const { shouldStop, onProgress, reportIntervalMs = 120 } = options
  if (!challenge || bits <= 0) {
    return null
  }
  const startedAt = Date.now()
  let lastReportAt = startedAt
  let hashes = 0
  for (let nonce = 0; ; nonce++) {
    const digest = sha256(`${challenge}:${nonce}`)
    hashes++
    if (countLeadingZeroBits(digest) >= bits) {
      return { nonce: String(nonce), hashes, elapsedMs: Date.now() - startedAt }
    }
    if (hashes % POW_BATCH_SIZE === 0) {
      if (shouldStop?.()) {
        return null
      }
      const now = Date.now()
      if (onProgress && now - lastReportAt >= reportIntervalMs) {
        lastReportAt = now
        onProgress({ hashes, elapsedMs: now - startedAt })
      }
    }
  }
}

/** 加载 forge 并返回同步 sha256（懒加载：不进主 bundle，与密码加密同款做法）。 */
export async function createForgeSha256(): Promise<Sha256Hex> {
  const forge = await import('node-forge')
  return (input: string) =>
    forge.md.sha256.create().update(input, 'utf8').digest().toHex()
}

/** 主线程兜底求解（Worker 不可用或报错时用；18 位约 0.4 秒，可接受）。 */
export async function solveActivationPoWInline(
  challenge: string,
  bits: number,
  options: SolveOptions = {}
): Promise<string> {
  const sha256 = await createForgeSha256()
  const result = solveWithSha256(sha256, challenge, bits, options)
  if (!result) {
    throw new Error('activation pow cancelled')
  }
  return result.nonce
}

/** 校验一次解（前端自检用；服务端仍会独立校验）。 */
export async function verifyActivationPoW(
  challenge: string,
  nonce: string,
  bits: number
): Promise<boolean> {
  if (!challenge || bits <= 0 || !isDecimalNonce(nonce)) {
    return false
  }
  const sha256 = await createForgeSha256()
  return countLeadingZeroBits(sha256(`${challenge}:${nonce}`)) >= bits
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<PowWorkerRequest>) => void) | null
  postMessage: (message: PowWorkerResponse) => void
}

/** 创建 PoW Worker；环境不支持（如单测的 jsdom）时返回 null，由调用方走主线程兜底。 */
export function createActivationPowWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  try {
    // 注意路径：本文件在 activate/lib/ 下，worker 入口在上一层。
    return new Worker(new URL('../pow.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    return null
  }
}

/** Worker 入口使用的运行时作用域（避免为 worker 单独引入 webworker lib 类型）。 */
export function activationPowScope(): {
  scope: WorkerScope
  solve: (challenge: string, bits: number) => Promise<void>
} {
  const scope = self as unknown as WorkerScope
  let cancelled = false
  scope.onmessage = (event) => {
    if (event.data?.type === 'cancel') {
      cancelled = true
      return
    }
    if (event.data?.type !== 'solve') {
      return
    }
    cancelled = false
    const { challenge, bits } = event.data
    void solve(challenge, bits)
  }
  async function solve(challenge: string, bits: number) {
    try {
      const sha256 = await createForgeSha256()
      const result = solveWithSha256(sha256, challenge, bits, {
        shouldStop: () => cancelled,
        onProgress: ({ hashes, elapsedMs }) =>
          scope.postMessage({ type: 'progress', hashes, elapsedMs }),
      })
      if (!result) {
        return
      }
      scope.postMessage({
        type: 'done',
        nonce: result.nonce,
        hashes: result.hashes,
        elapsedMs: result.elapsedMs,
      })
    } catch (error) {
      scope.postMessage({
        type: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { scope, solve }
}
