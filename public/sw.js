/**
 * Service Worker — cache tài nguyên tĩnh sau lần tải đầu (mạng yếu / lần sau mở nhanh hơn).
 * Không cache HTML navigation để tránh bundle JS cũ; chỉ cache JS/CSS/font/worker.
 */
const CACHE_VERSION = 'bhpt-pwa-v2'
const CACHE_NAME = `bhpt-assets-${CACHE_VERSION}`

const STATIC_EXT = /\.(?:js|mjs|css|woff2?|svg|png|jpg|jpeg|gif|webp|ico|worker\.js|wasm)$/i

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return
  if (!STATIC_EXT.test(url.pathname)) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req)
      if (cached) return cached
      try {
        const res = await fetch(req)
        if (res && res.ok && res.type === 'basic') {
          try {
            cache.put(req, res.clone())
          } catch {
            /* ignore quota / opaque */
          }
        }
        return res
      } catch {
        return cached || Promise.reject(new Error('offline'))
      }
    })
  )
})
