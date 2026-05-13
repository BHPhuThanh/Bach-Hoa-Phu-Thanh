import { useEffect, useMemo, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { blurActiveElement } from './scanFeedback.js'
import './barcodeScan.css'

/** Khoảng cách tối thiểu giữa hai lần báo (ms) — tránh html5-qrcode bắn trùng khung hình. */
const SCAN_DEBOUNCE_MS = 520

/**
 * Quét mã vạch / QR — chế độ quét liên tục: không đóng modal, không dừng camera.
 * `onScan(decodedText)` — tiếng beep + toast do parent xử lý sau `blur`.
 */
export default function BarcodeScanModal({ open, title = 'Quét mã vạch', onClose, onScan }) {
  const readerId = useMemo(() => `bhpt-qr-${Math.random().toString(36).slice(2, 11)}`, [])
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  const lastScanRef = useRef({ text: '', at: 0 })
  onScanRef.current = onScan
  onCloseRef.current = onClose
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    let h5 = null
    setErr('')
    lastScanRef.current = { text: '', at: 0 }

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
          const prev = lastScanRef.current
          if (t === prev.text && now - prev.at < SCAN_DEBOUNCE_MS) return
          lastScanRef.current = { text: t, at: now }
          blurActiveElement()
          try {
            onScanRef.current?.(t)
          } catch (e) {
            console.warn('[BarcodeScanModal] onScan', e)
          }
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
          Đưa mã vào khung giữa — quét liên tục, bấm «Hủy» hoặc × để tắt camera. Cần HTTPS hoặc localhost.
        </p>
        <div id={readerId} className="barcode-scan-viewport" />
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
