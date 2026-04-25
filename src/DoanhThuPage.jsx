import './App.css'
import './dashboard-dark.css'
import AdminHub from './AdminHub.jsx'
import DoanhThuErrorBoundary from './DoanhThuErrorBoundary.jsx'
import { readStoredSellerId } from './sellerRoleStorage.js'
import { usePrintReceiptIframe } from './usePrintReceiptIframe.js'

export default function DoanhThuPage() {
  const { receiptIframeRef, printReceiptHtml } = usePrintReceiptIframe()
  const isAdmin = readStoredSellerId() === 'admin'

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
          refreshKey={0}
          doanhThuMode={isAdmin ? undefined : { readOnlyRevenue: true }}
        />
      </DoanhThuErrorBoundary>
    </div>
  )
}
