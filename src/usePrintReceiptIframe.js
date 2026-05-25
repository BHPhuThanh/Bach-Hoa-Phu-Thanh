import { useCallback, useEffect, useRef } from 'react'

/**
 * @param {() => void} [onAfterPrintDismiss] — gọi khi đóng hộp thoại In (ESC / Hủy / In xong).
 */
export function usePrintReceiptIframe(onAfterPrintDismiss) {
  const receiptIframeRef = useRef(null)
  const onAfterPrintDismissRef = useRef(onAfterPrintDismiss)
  useEffect(() => {
    onAfterPrintDismissRef.current = onAfterPrintDismiss
  }, [onAfterPrintDismiss])

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

    let recovered = false
    const recoverFocus = () => {
      if (recovered) return
      recovered = true
      onAfterPrintDismissRef.current?.()
    }

    const onAfterPrint = () => {
      window.removeEventListener('afterprint', onAfterPrint)
      recoverFocus()
    }
    window.addEventListener('afterprint', onAfterPrint)

    window.setTimeout(() => {
      try {
        win.focus()
        win.print()
      } catch {
        recoverFocus()
      }
      window.setTimeout(recoverFocus, 2000)
    }, 500)
  }, [])
  return { receiptIframeRef, printReceiptHtml }
}
