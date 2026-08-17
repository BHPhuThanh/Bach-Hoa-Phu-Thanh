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
 * @param {{
 *   onPrintDialogOpen?: () => void,
 *   onPrintDialogClose?: () => void,
 *   onPrintFailed?: (error: unknown) => void,
 * }} [callbacks]
 */
export function usePrintReceiptIframe(callbacks) {
  const receiptIframeRef = useRef(null)
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  /**
   * KHÔNG BAO GIỜ throw ra ngoài — đơn hàng đã lưu Supabase xong trước khi hàm này được gọi,
   * lỗi in ở đây tuyệt đối không được coi là lỗi lưu đơn. Thất bại thật sự báo qua `onPrintFailed`
   * (App hiển thị toast vàng riêng, khác với lỗi đồng bộ đỏ) thay vì throw / window.alert chặn luồng.
   */
  const printReceiptHtml = useCallback((html) => {
    const frame = receiptIframeRef.current
    const win = frame?.contentWindow
    if (!frame || !win) {
      callbacksRef.current?.onPrintFailed?.(new Error('Iframe in hóa đơn chưa sẵn sàng.'))
      return
    }
    const doc = frame.contentDocument || win.document
    try {
      doc.open()
      doc.write(html)
      doc.close()
    } catch (e) {
      callbacksRef.current?.onPrintFailed?.(e)
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
      } catch (e) {
        window.removeEventListener('focus', onWinFocus)
        try {
          win.removeEventListener('afterprint', onAfterPrintIframe)
        } catch {
          /* ignore */
        }
        closeDialog()
        callbacksRef.current?.onPrintFailed?.(e)
        return
      }
      window.setTimeout(() => {
        window.removeEventListener('focus', onWinFocus)
        try {
          win.removeEventListener('afterprint', onAfterPrintIframe)
        } catch {
          /* ignore */
        }
        // Không coi timeout này là thất bại — nhiều trình duyệt không bắn `afterprint` đều đặn
        // khi in từ iframe dù lệnh in đã chạy bình thường (tránh báo nhầm "lỗi" cho thao tác đã ổn).
        if (!closed) closeDialog()
      }, 4000)
    }, 500)
  }, [])

  return { receiptIframeRef, printReceiptHtml }
}
