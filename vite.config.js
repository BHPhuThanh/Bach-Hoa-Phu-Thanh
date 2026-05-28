import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** SPA: GET /.../doanh-thu → index.html (dev + preview) */
function historyFallbackDoanhThu() {
  return {
    name: 'history-fallback-doanh-thu',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        applyDoanhThuFallback(req, next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        applyDoanhThuFallback(req, next)
      })
    },
  }
}

const SPA_PATH_SUFFIXES = [
  '/doanh-thu',
  '/hang-hoa',
  '/don-hang',
  '/nhap-hang',
  '/tra-hang',
  '/danh-sach-don-hang',
  '/doi-tra-hang',
  '/admin/orders',
  '/tong-quan',
  '/kiem-hang',
  '/dieu-chinh-gia',
  '/khach-hang',
  '/nhan-vien',
  '/nha-cung-cap',
]

function applyDoanhThuFallback(req, next) {
  const raw = req.url || ''
  const path = raw.split('?')[0]
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  const q = raw.includes('?') ? '?' + raw.split('?').slice(1).join('?') : ''

  const retIdx = path.indexOf('/admin/return-order/')
  if (retIdx >= 0) {
    let basePath = path.slice(0, retIdx)
    if (!basePath) basePath = '/'
    else if (!basePath.endsWith('/')) basePath += '/'
    req.url = basePath + q
    return next()
  }

  /** `/hang-hoa/:productId` — dev/preview cần fallback về index.html */
  const hangIdx = path.toLowerCase().indexOf('/hang-hoa/')
  if (hangIdx >= 0) {
    let basePath = path.slice(0, hangIdx)
    if (!basePath) basePath = '/'
    else if (!basePath.endsWith('/')) basePath += '/'
    req.url = basePath + q
    return next()
  }

  let matchedSuffix = ''
  for (const s of SPA_PATH_SUFFIXES) {
    if (path.endsWith(s)) {
      matchedSuffix = s
      break
    }
  }
  if (!matchedSuffix) return next()
  const idx = path.lastIndexOf(matchedSuffix)
  let basePath = idx >= 0 ? path.slice(0, idx) : '/'
  if (!basePath) basePath = '/'
  else if (!basePath.endsWith('/')) basePath += '/'
  req.url = basePath + q
  next()
}

export default defineConfig(() => ({
  /** SPA: route lạ (vd. /hang-hoa/SP001) → index.html — Vite không có `historyApiFallback` (Webpack). */
  appType: 'spa',
  server: {
    /**
     * Tương đương ý “historyApiFallback”: dev server phục vụ SPA.
     * Plugin `historyFallbackDoanhThu` bổ sung rewrite cho `/hang-hoa/...`, đơn hàng, v.v.
     */
    historyApiFallback: true,
    /** Dev: tránh trình duyệt giữ module cũ khi đổi code (cùng Ctrl+Shift+R nếu vẫn lệch). */
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  preview: {
    historyApiFallback: true,
  },
  build: {
    sourcemap: true,
  },
  plugins: [react(), historyFallbackDoanhThu()],
}))
