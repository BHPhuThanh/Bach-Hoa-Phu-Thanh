import { useCallback, useRef } from 'react'

export function usePrintReceiptIframe() {
  const receiptIframeRef = useRef(null)
  const printReceiptHtml = useCallback((html) => {
    const frame = receiptIframeRef.current
    const win = frame?.contentWindow
    if (!frame || !win) return
    const doc = frame.contentDocument || win.document
    try {
      doc.open()
      doc.write(html)
      doc.close()
    } catch {
      window.alert('Không ghi được nội dung hóa đơn vào iframe.')
      return
    }
    window.setTimeout(() => {
      try {
        win.focus()
        win.print()
      } catch {
        /* ignore */
      }
    }, 500)
  }, [])
  return { receiptIframeRef, printReceiptHtml }
}
