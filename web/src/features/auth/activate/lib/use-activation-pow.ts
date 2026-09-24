// @muw-owned
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createActivationPowWorker,
  solveActivationPoWInline,
  type PowProgress,
  type PowWorkerResponse,
} from './activation-pow'

export type ActivationPowStatus = 'idle' | 'solving' | 'done' | 'failed'

export type ActivationPowState = {
  status: ActivationPowStatus
  hashes: number
  elapsedMs: number
}

/**
 * 激活页人机校验（PoW）求解器：默认在 Worker 里算（界面不卡），环境不支持时回落到主线程。
 *
 * 失败/取消都只是状态，**不影响激活资格**：调用方据此决定重试或提示，
 * 绝不会因为"算不出 PoW"而去停用账号（服务端同样只把它当通过/未通过，不做加罚）。
 */
export function useActivationPow() {
  const workerRef = useRef<Worker | null>(null)
  const cancelRef = useRef(false)
  const [state, setState] = useState<ActivationPowState>({
    status: 'idle',
    hashes: 0,
    elapsedMs: 0,
  })

  useEffect(() => {
    return () => {
      cancelRef.current = true
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    setState({ status: 'idle', hashes: 0, elapsedMs: 0 })
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
    workerRef.current?.postMessage({ type: 'cancel' })
  }, [])

  const solve = useCallback(
    async (challenge: string, bits: number): Promise<string> => {
      cancelRef.current = false
      setState({ status: 'solving', hashes: 0, elapsedMs: 0 })
      const onProgress = (progress: PowProgress) =>
        setState({
          status: 'solving',
          hashes: progress.hashes,
          elapsedMs: progress.elapsedMs,
        })

      const worker = workerRef.current ?? createActivationPowWorker()
      workerRef.current = worker

      try {
        let nonce: string
        if (worker) {
          try {
            nonce = await solveWithWorker(worker, challenge, bits, onProgress, cancelRef)
          } catch {
            // Worker 只是优化：它挂了（打包/加载/运行异常）就退回主线程算一遍，
            // 不让"算力分发"这种实现细节挡住真人激活。
            nonce = await solveActivationPoWInline(challenge, bits, {
              shouldStop: () => cancelRef.current,
              onProgress,
            })
          }
        } else {
          nonce = await solveActivationPoWInline(challenge, bits, {
            shouldStop: () => cancelRef.current,
            onProgress,
          })
        }
        setState((previous) => ({
          status: 'done',
          hashes: previous.hashes,
          elapsedMs: previous.elapsedMs,
        }))
        return nonce
      } catch (error) {
        setState((previous) => ({ ...previous, status: 'failed' }))
        throw error
      }
    },
    []
  )

  return { ...state, solve, cancel, reset }
}

function solveWithWorker(
  worker: Worker,
  challenge: string,
  bits: number,
  onProgress: (progress: PowProgress) => void,
  cancelRef: { current: boolean }
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
    }
    const handleMessage = (event: MessageEvent<PowWorkerResponse>) => {
      const data = event.data
      if (data?.type === 'progress') {
        onProgress({ hashes: data.hashes, elapsedMs: data.elapsedMs })
        return
      }
      cleanup()
      if (data?.type === 'done') {
        onProgress({ hashes: data.hashes, elapsedMs: data.elapsedMs })
        resolve(data.nonce)
        return
      }
      reject(new Error(data?.message || 'activation pow worker failed'))
    }
    const handleError = () => {
      cleanup()
      reject(new Error('activation pow worker error'))
    }
    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    if (cancelRef.current) {
      cleanup()
      reject(new Error('activation pow cancelled'))
      return
    }
    worker.postMessage({ type: 'solve', challenge, bits })
  })
}
