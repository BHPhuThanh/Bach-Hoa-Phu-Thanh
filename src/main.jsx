import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import PosPage from './PosPage.jsx'
import CostAdjustCreatePage from './CostAdjustCreatePage.jsx'
import DoanhThuPage from './DoanhThuPage.jsx'
import StockCheckCreatePage from './StockCheckCreatePage.jsx'
import InboundCreatePage from './InboundCreatePage.jsx'
import { clearCatalogBrowserCacheOnBoot } from './catalogCachePurgeBoot.js'
import { registerPwaServiceWorker } from './pwaRegister.js'

/** Chặn Chrome Help (F1) ngay từ boot — không phụ thuộc mount React hay trạng thái loading. */
function installGlobalF1HelpBlocker() {
  if (typeof window === 'undefined') return
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'F1') return
      e.preventDefault()
      e.stopPropagation()
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation()
      }
    },
    { capture: true }
  )
}

installGlobalF1HelpBlocker()

function appRouterBasename() {
  const raw = import.meta.env.BASE_URL || '/'
  if (raw === '/') return undefined
  return raw.replace(/\/$/, '') || undefined
}

async function boot() {
  await clearCatalogBrowserCacheOnBoot()
  registerPwaServiceWorker()
  const el = document.getElementById('root')
  if (!el) return
  createRoot(el).render(
    <StrictMode>
      <BrowserRouter basename={appRouterBasename()}>
        <Routes>
          <Route path="admin/goods" element={<PosPage />} />
          <Route path="admin/inventory" element={<PosPage />} />
          <Route path="dieu-chinh-gia/tao-moi" element={<CostAdjustCreatePage />} />
          <Route path="kiem-hang/tao-moi" element={<StockCheckCreatePage />} />
          <Route path="nhap-hang/tao-moi" element={<InboundCreatePage />} />
          <Route path="doanh-thu" element={<DoanhThuPage />} />
          <Route path="*" element={<PosPage />} />
        </Routes>
      </BrowserRouter>
    </StrictMode>,
  )
}

boot()
