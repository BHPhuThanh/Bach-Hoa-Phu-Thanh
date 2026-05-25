import { useCallback, useEffect, useRef } from 'react'

/** Lớp 2: trả focus về POS sau khi đóng hộp thoại in (iframe không giữ focus). */
function restorePosMainWindowFocus() {
  try {
    window.focus()
  } catch {
    /* ignore */
  }
  window.setTimeout(() => {
    document.getElementById('pos-search-input')?.focus?.()
  }, 50)
}

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
      restorePosMainWindowFocus()
    }

    callbacksRef.current?.onPrintDialogOpen?.()

    const onAfterPrintMain = () => {
      window.removeEventListener('afterprint', onAfterPrintMain)
      closeDialog()
    }
    window.addEventListener('afterprint', onAfterPrintMain)

    const onAfterPrintIframe = () => {
      try {
        win.removeEventListener('afterprint', onAfterPrintIframe)
      } catch {
        /* ignore */
      }
      closeDialog()
    }
    try {
      win.addEventListener('afterprint', onAfterPrintIframe)
    } catch {
      /* iframe onafterprint không khả dụng — dùng afterprint trên window */
    }

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
        try {
          win.removeEventListener('afterprint', onAfterPrintIframe)
        } catch {
          /* ignore */
        }
        closeDialog()
      }
      window.setTimeout(() => {
        window.removeEventListener('focus', onWinFocus)
        try {
          win.removeEventListener('afterprint', onAfterPrintIframe)
        } catch {
          /* ignore */
        }
        if (!closed) closeDialog()
      }, 4000)
    }, 500)
  }, [])

  return { receiptIframeRef, printReceiptHtml }
}
