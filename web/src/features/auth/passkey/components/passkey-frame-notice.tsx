import { useTranslation } from 'react-i18next'

/**
 * 桌面壳把页面渲染在 iframe 里，浏览器扩展（如 Bitwarden）会拦截 iframe 内的
 * 通行密钥调用并抛出 `Invalid 'sameOriginWithAncestors' value`。只在窗口内提示：
 * 顶层页面没有这个问题，不要打扰。
 */
export function PasskeyFrameNotice() {
  const { t } = useTranslation()
  if (typeof window === 'undefined' || window.self === window.top) return null
  return (
    <p className='text-muted-foreground text-xs' role='note'>
      {t(
        'Extensions can block passkeys inside desktop windows — turn off passkey handling in the extension (e.g. Bitwarden) if it fails.'
      )}
    </p>
  )
}
