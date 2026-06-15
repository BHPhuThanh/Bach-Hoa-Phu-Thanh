import { useCallback } from 'react'
import './App.css'
import './dashboard-dark.css'
import AdminHub from './AdminHub.jsx'
import DoanhThuErrorBoundary from './DoanhThuErrorBoundary.jsx'
import { useCatalog } from './CatalogProvider.jsx'
import { revalidateCatalogFromStore } from './catalogRepository.js'
import { prepareCatalogForPosSearch } from './catalogSearchSimple.js'
import { isSupabaseConfigured } from './supabaseClient.js'
import { useRoleStore } from './roleStore.js'
import { usePrintReceiptIframe } from './usePrintReceiptIframe.js'

export default function DoanhThuPage() {
  const { receiptIframeRef, printReceiptHtml } = usePrintReceiptIframe()
  const { isAdmin } = useRoleStore()
  const {
    products,
    setProducts,
    productsRef,
    fileName,
    setFileName,
    setCsvRowCount,
  } = useCatalog()

  const onRevalidateCatalog = useCallback(async () => {
    if (!isSupabaseConfigured()) return null
    const fresh = await revalidateCatalogFromStore()
    if (!fresh?.products?.length) return null
    const prepared = prepareCatalogForPosSearch(fresh.products)
    setProducts(prepared)
    productsRef.current = prepared
    setFileName(fresh.fileName)
    setCsvRowCount(fresh.csvRowCount)
    return fresh
  }, [setProducts, productsRef, setFileName, setCsvRowCount])

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
          products={products}
          catalogFileName={fileName}
          onRevalidateCatalog={onRevalidateCatalog}
          doanhThuMode={isAdmin ? undefined : { readOnlyRevenue: true }}
        />
      </DoanhThuErrorBoundary>
    </div>
  )
}
