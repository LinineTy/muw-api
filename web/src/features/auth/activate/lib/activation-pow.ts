// @muw-owned
/**
 * 人机校验（PoW）求解：找出 nonce，使 sha256("{challenge}:{nonce}") 具有足够的前导零位。
 *
 * 判别方式与后端 `model/pow_challenge.go` 一致，难度由服务端下发。
 * 使用 node-forge 的纯 JS sha256（已随项目打包）：HTTP 环境下 `crypto.subtle` 不可用。
 */
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

/** 同步 sha256（十六进制小写），由调用方注入（Worker 用 forge，测试可用假实现）。 */
export type Sha256Hex = (input: string) => string

/** 统计十六进制摘要的前导零位数。 */
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

/** 按期望工作量估算进度，封顶 0.98。 */
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

/** 求解循环：nonce 从 0 递增到满足难度；被取消返回 null。 */
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

/** 懒加载 forge 并返回同步 sha256（不进主 bundle）。 */
export async function createForgeSha256(): Promise<Sha256Hex> {
  const forge = await import('node-forge')
  return (input: string) =>
    forge.md.sha256.create().update(input, 'utf8').digest().toHex()
}

/** 主线程兜底求解（Worker 不可用或报错时使用）。 */
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

/** 校验一次解（前端自检；服务端仍会独立校验）。 */
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

/** 创建 Worker；环境不支持时返回 null，由调用方走主线程兜底。 */
export function createActivationPowWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  try {
    // worker 入口在上一层目录
    return new Worker(new URL('../pow.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    return null
  }
}

/** Worker 入口的运行时作用域（避免引入 webworker 类型库）。 */
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
