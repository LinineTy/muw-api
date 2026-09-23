// @muw-owned
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'legal-consent-agreed'

/**
 * 法务勾选记忆：同一台浏览器勾过一次之后，下次打开登录 / 注册页默认就是勾上的
 * （取消勾选会立刻忘掉，避免"其实没同意却记着同意"）。
 */
export function useLegalConsent() {
  const [agreedToLegal, setAgreed] = useState(false)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === '1') setAgreed(true)
    } catch {
      // 取不到 localStorage（隐私模式等）：保持未勾选，行为与以前一致
    }
  }, [])

  const setAgreedToLegal = useCallback((value: boolean) => {
    setAgreed(value)
    try {
      if (value) {
        window.localStorage.setItem(STORAGE_KEY, '1')
      } else {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // 存不进去就算了，不影响本次会话
    }
  }, [])

  return { agreedToLegal, setAgreedToLegal }
}
