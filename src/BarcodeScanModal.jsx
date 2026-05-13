import { useEffect, useMemo, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { blurActiveElement, playScanSuccessBeep } from './scanFeedback.js'
import './barcodeScan.css'

/** Gộp hai lần đọc giống hệt trong một khung (html5-qrcode hay lặp). */
const SCAN_SAME_CODE_DEBOUNCE_MS = 400
/** Sau mỗi lần xử lý mã: không nhận mã mới trong khoảng này (camera vẫn mở). */
const SCAN_COOLDOWN_MS = 1200

/**
 * Quét mã vạch / QR — quét liên tục; không đóng modal.
 * Thứ tự: beep → `onScan(text)` (toast do parent) → nghỉ {@link SCAN_COOLDOWN_MS} ms.
 */
export default function BarcodeScanModal({ open, title = 'Quét mã vạch', onClose, onScan }) {
  const readerId = useMemo(() => `bhpt-qr-${Math.random().toString(36).slice(2, 11)}`, [])
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  const lastScanRef = useRef({ text: '', at: 0 })
  /** Chặn mọi decode đến hết timestamp (ms). */
  const cooldownUntilRef = useRef(0)
  const [err, setErr] = useState('')
  const [viewportFlash, setViewportFlash] = useState(false)

  onScanRef.current = onScan
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    let h5 = null
    setErr('')
    lastScanRef.current = { text: '', at: 0 }
    cooldownUntilRef.current = 0

    const stop = async () => {
      if (!h5) return
      try {
        await h5.stop()
      } catch {
        /* ignore */
      }
      try {
        await h5.clear()
      } catch {
        /* ignore */
      }
    }

    const run = async () => {
      try {
        h5 = new Html5Qrcode(readerId, { verbose: false })
        const config = { fps: 8, qrbox: { width: 280, height: 160 } }

        const onDecoded = (text) => {
          const t = String(text ?? '').trim()
          if (!t || cancelled) return

          const now = Date.now()
          if (now < cooldownUntilRef.current) return

          const prev = lastScanRef.current
          if (t === prev.text && now - prev.at < SCAN_SAME_CODE_DEBOUNCE_MS) return
          lastScanRef.current = { text: t, at: now }

          blurActiveElement()
          playScanSuccessBeep()
          setViewportFlash(true)
          window.setTimeout(() => setViewportFlash(false), 420)

          try {
            onScanRef.current?.(t)
          } catch (e) {
            console.warn('[BarcodeScanModal] onScan', e)
          }

          cooldownUntilRef.current = Date.now() + SCAN_COOLDOWN_MS
        }

        try {
          await h5.start({ facingMode: 'environment' }, config, onDecoded, () => {})
        } catch {
          const cams = await Html5Qrcode.getCameras()
          if (!cams?.length) throw new Error('Không tìm thấy camera.')
          await h5.start({ deviceId: { exact: cams[0].id } }, config, onDecoded, () => {})
        }
      } catch (e) {
        if (!cancelled) {
          setErr(String(e?.message || e || 'Không mở được camera.'))
        }
      }
    }

    void run()

    return () => {
      cancelled = true
      void stop()
    }
  }, [open, readerId])

  if (!open) return null

  return (
    <div
      className="barcode-scan-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="barcode-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="barcode-scan-title">
        <header className="barcode-scan-head">
          <h2 id="barcode-scan-title" className="barcode-scan-title">
            {title}
          </h2>
          <button type="button" className="barcode-scan-close" aria-label="Đóng" onClick={() => onClose?.()}>
            ×
          </button>
        </header>
        <p className="barcode-scan-hint">
          Đưa mã vào khung — sau mỗi lần nhận có nghỉ ngắn để tránh quét trùng. Bấm «Hủy» hoặc × để tắt camera.
        </p>
        <div
          className={`barcode-scan-viewport-wrap${viewportFlash ? ' barcode-scan-viewport-wrap--flash' : ''}`}
          aria-hidden
        >
          <div id={readerId} className="barcode-scan-viewport" />
        </div>
        {err ? (
          <p className="barcode-scan-err" role="alert">
            {err}
          </p>
        ) : null}
        <footer className="barcode-scan-foot">
          <button type="button" className="barcode-scan-btn barcode-scan-btn--ghost" onClick={() => onClose?.()}>
            Hủy
          </button>
        </footer>
      </div>
    </div>
  )
}
