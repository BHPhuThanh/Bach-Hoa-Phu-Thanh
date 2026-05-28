import { useEffect, useState } from 'react'
import './App.css'
import './dashboard-dark.css'
import AdminHub from './AdminHub.jsx'
import DoanhThuErrorBoundary from './DoanhThuErrorBoundary.jsx'
import { ORDERS_SYNC_BUMP_EVENT } from './ordersSyncEvents.js'
import { POS_RETURN_LEDGER_BUMP_EVENT } from './posReturnLedgerRepository.js'
import { readStoredSellerId } from './sellerRoleStorage.js'
import { usePrintReceiptIframe } from './usePrintReceiptIframe.js'

export default function DoanhThuPage() {
  const { receiptIframeRef, printReceiptHtml } = usePrintReceiptIframe()
  const [isAdmin, setIsAdmin] = useState(() => readStoredSellerId() === 'admin')
  const [hubRefreshKey, setHubRefreshKey] = useState(0)

  useEffect(() => {
    const refreshRole = () => setIsAdmin(readStoredSellerId() === 'admin')
    const onStorage = (e) => {
      if (e.storageArea !== localStorage) return
      if (e.key !== 'csv-preview-pos-active-seller-id-v1') return
      refreshRole()
    }
    window.addEventListener('csv-preview-seller-role-changed', refreshRole)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('csv-preview-seller-role-changed', refreshRole)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    setHubRefreshKey((k) => k + 1)
  }, [isAdmin])

  useEffect(() => {
    const bump = () => setHubRefreshKey((k) => k + 1)
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump()
    }
    bump()
    window.addEventListener(ORDERS_SYNC_BUMP_EVENT, bump)
    window.addEventListener(POS_RETURN_LEDGER_BUMP_EVENT, bump)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(ORDERS_SYNC_BUMP_EVENT, bump)
      window.removeEventListener(POS_RETURN_LEDGER_BUMP_EVENT, bump)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <div className="app app--dark app--doanh-thu-shell">
      <iframe
        ref={receiptIframeRef}
        src="about:blank"
        title="Hóa đơn in từ báo cáo"
        className="print-receipt-iframe"
        aria-hidden="true"
        tabIndex={-1}
      />
      <DoanhThuErrorBoundary>
        <AdminHub
          printReceiptHtml={printReceiptHtml}
          refreshKey={hubRefreshKey}
          doanhThuMode={isAdmin ? undefined : { readOnlyRevenue: true }}
        />
      </DoanhThuErrorBoundary>
    </div>
  )
}
