/**
 * Đăng ký Service Worker (cache tài nguyên tĩnh) + log nhẹ — không ảnh hưởng logic app.
 */
export function registerPwaServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const run = () => {
    const base = import.meta.env.BASE_URL || '/'
    const normalized = base.endsWith('/') ? base : `${base}/`
    const swUrl = `${normalized}sw.js`
    navigator.serviceWorker.register(swUrl, { scope: normalized }).catch((err) => {
      console.warn('[PWA] Không đăng ký được Service Worker:', err)
    })
  }

  if (document.readyState === 'complete') run()
  else window.addEventListener('load', run, { once: true })
}
