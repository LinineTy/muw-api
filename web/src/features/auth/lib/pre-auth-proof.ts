// @muw-owned
/**
 * 前置校验（PoW）凭据的暂存处。
 *
 * 需要凭据的请求分散在 api 与各入口组件里，服务端对挑战是一次性的，
 * 因此凭据被取走时要通知浮窗重新计算。单页内同一时刻只有一次登录流程，单例即可。
 */
export type PreAuthProof = {
  challengeId: string
  nonce: string
}

let proof: PreAuthProof | null = null
let consumedListener: (() => void) | null = null

export function setPreAuthProof(next: PreAuthProof | null) {
  proof = next
}

export function getPreAuthProof(): PreAuthProof | null {
  return proof
}

/** 取走凭据（只给一次），并通知浮窗重新计算。 */
export function takePreAuthProof(): PreAuthProof | null {
  const current = proof
  proof = null
  consumedListener?.()
  return current
}

/** 注册"凭据被取走"的回调，返回解绑函数。 */
export function onPreAuthProofConsumed(listener: () => void) {
  consumedListener = listener
  return () => {
    if (consumedListener === listener) {
      consumedListener = null
    }
  }
}
