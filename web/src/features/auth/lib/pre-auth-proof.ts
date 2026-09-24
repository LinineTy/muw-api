// @muw-owned
/**
 * 前置人机校验（PoW）凭据的临时存放处。
 *
 * 为什么要一个模块级小仓库：登录页的校验浮窗挂在页面上，而真正要带凭据发请求的地方
 * （登录、注册、第三方登录发起）分散在 hook 与组件里，中间隔着两三层 props。
 * 服务端对挑战是**一次性**的，所以凭据用掉后必须让页面重新算一遍 ——
 * 这里用"消费即通知"的方式把这件事告诉持有浮窗的那个 hook。
 *
 * 单页应用内一次只会有一个人在登录，所以单例足够；凭据本身不含敏感信息。
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

/** 取走凭据（服务端一次性消费，客户端同样只给一次），并通知浮窗重新算一道。 */
export function takePreAuthProof(): PreAuthProof | null {
  const current = proof
  proof = null
  consumedListener?.()
  return current
}

/** 注册"凭据被消费"的回调；返回解绑函数（hook 卸载时调用）。 */
export function onPreAuthProofConsumed(listener: () => void) {
  consumedListener = listener
  return () => {
    if (consumedListener === listener) {
      consumedListener = null
    }
  }
}
