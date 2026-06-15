import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import CostAdjustCreatePage from './CostAdjustCreatePage.jsx'
import DoanhThuPage from './DoanhThuPage.jsx'
import StockCheckCreatePage from './StockCheckCreatePage.jsx'
import { clearCatalogBrowserCacheOnBoot } from './catalogCachePurgeBoot.js'
import { CatalogProvider } from './CatalogProvider.jsx'
import { NotificationsProvider } from './NotificationsProvider.jsx'
import { registerPwaServiceWorker } from './pwaRegister.js'

/** Lớp 1: chặn Chrome Help — chỉ preventDefault, không stopPropagation (React vẫn nhận F1). */
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'F1') {
        e.preventDefault()
      }
    },
    { capture: true }
  )
}

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
      <CatalogProvider>
        <NotificationsProvider>
          <BrowserRouter basename={appRouterBasename()}>
            <Routes>
              <Route path="admin/goods" element={<App />} />
              <Route path="admin/inventory" element={<App />} />
              <Route path="dieu-chinh-gia/tao-moi" element={<CostAdjustCreatePage />} />
              <Route path="kiem-hang/tao-moi" element={<StockCheckCreatePage />} />
              <Route path="nhap-hang/tao-moi" element={<App standaloneInboundCreate />} />
              <Route path="doanh-thu" element={<DoanhThuPage />} />
              <Route path="*" element={<App />} />
            </Routes>
          </BrowserRouter>
        </NotificationsProvider>
      </CatalogProvider>
    </StrictMode>,
  )
}

boot()
