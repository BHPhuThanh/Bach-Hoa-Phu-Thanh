import { useCallback, useEffect, useRef } from 'react'

/**
 * @param {{ onPrintDialogOpen?: () => void, onPrintDialogClose?: () => void }} [callbacks]
 */
export function usePrintReceiptIframe(callbacks) {
  const receiptIframeRef = useRef(null)
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

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

    const openedAt = Date.now()
    let closed = false
    const closeDialog = () => {
      if (closed) return
      closed = true
      callbacksRef.current?.onPrintDialogClose?.()
    }

    callbacksRef.current?.onPrintDialogOpen?.()

    const onAfterPrint = () => {
      window.removeEventListener('afterprint', onAfterPrint)
      closeDialog()
    }
    window.addEventListener('afterprint', onAfterPrint)

    const onWinFocus = () => {
      if (closed) return
      if (Date.now() - openedAt < 450) return
      window.removeEventListener('focus', onWinFocus)
      closeDialog()
    }
    window.addEventListener('focus', onWinFocus)

    window.setTimeout(() => {
      try {
        win.focus()
        win.print()
      } catch {
        window.removeEventListener('focus', onWinFocus)
        closeDialog()
      }
      window.setTimeout(() => {
        window.removeEventListener('focus', onWinFocus)
        closeDialog()
      }, 4000)
    }, 500)
  }, [])

  return { receiptIframeRef, printReceiptHtml }
}
