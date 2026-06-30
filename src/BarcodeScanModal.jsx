import { useEffect, useMemo, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { blurActiveElement, playScanSuccessBeep } from './scanFeedback.js'
import './barcodeScan.css'

/** Gộp hai lần đọc giống hệt trong một khung (html5-qrcode hay lặp). */
const SCAN_SAME_CODE_DEBOUNCE_MS = 400
/** Sau mỗi lần xử lý mã: không nhận mã mới trong khoảng này (camera vẫn mở). */
const SCAN_COOLDOWN_MS = 1200

/** Khung quét vuông — tập trung vùng giữa (tốt cho iOS không macro-focus). */
const SCAN_QRBOX = { width: 250, height: 250 }

const SCAN_CONFIG_BASE = {
  fps: 10,
  qrbox: SCAN_QRBOX,
  aspectRatio: 1,
  disableFlip: false,
}

/** Độ phân giải cao + camera sau + continuous focus (iOS PWA / Safari). */
const HIGH_RES_VIDEO_CONSTRAINTS = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  advanced: [{ focusMode: 'continuous' }],
}

const HIGH_RES_VIDEO_CONSTRAINTS_EXACT_REAR = {
  facingMode: { exact: 'environment' },
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  advanced: [{ focusMode: 'continuous' }],
}

function pickRearCameraId(cameras) {
  const list = Array.isArray(cameras) ? cameras : []
  if (!list.length) return null
  const rear = list.find((c) => /back|rear|environment|sau/i.test(String(c?.label ?? '')))
  return (rear ?? list[list.length - 1])?.id ?? null
}

async function applyContinuousFocus(h5) {
  if (!h5?.applyVideoConstraints) return
  try {
    await h5.applyVideoConstraints({
      advanced: [{ focusMode: 'continuous' }],
    })
  } catch {
    try {
      await h5.applyVideoConstraints({ focusMode: 'continuous' })
    } catch {
      /* iOS Safari thường bỏ qua — không chặn quét */
    }
  }
}

async function startScannerWithFallback(h5, onDecoded) {
  const noop = () => {}
  const attempts = [
    () =>
      h5.start(
        { facingMode: { exact: 'environment' } },
        { ...SCAN_CONFIG_BASE, videoConstraints: HIGH_RES_VIDEO_CONSTRAINTS_EXACT_REAR },
        onDecoded,
        noop
      ),
    () =>
      h5.start(
        { facingMode: 'environment' },
        { ...SCAN_CONFIG_BASE, videoConstraints: HIGH_RES_VIDEO_CONSTRAINTS },
        onDecoded,
        noop
      ),
    () => h5.start({ facingMode: 'environment' }, SCAN_CONFIG_BASE, onDecoded, noop),
    async () => {
      const cams = await Html5Qrcode.getCameras()
      const deviceId = pickRearCameraId(cams)
      if (!deviceId) throw new Error('Không tìm thấy camera.')
      await h5.start(
        { deviceId: { exact: deviceId } },
        { ...SCAN_CONFIG_BASE, videoConstraints: HIGH_RES_VIDEO_CONSTRAINTS },
        onDecoded,
        noop
      )
    },
    async () => {
      const cams = await Html5Qrcode.getCameras()
      if (!cams?.length) throw new Error('Không tìm thấy camera.')
      await h5.start({ deviceId: { exact: cams[0].id } }, SCAN_CONFIG_BASE, onDecoded, noop)
    },
  ]

  let lastErr = null
  for (const attempt of attempts) {
    try {
      await attempt()
      return
    } catch (e) {
      lastErr = e
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
  }
  throw lastErr ?? new Error('Không mở được camera.')
}

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
    let focusTimer = 0
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

        await startScannerWithFallback(h5, onDecoded)
        focusTimer = window.setTimeout(() => {
          if (!cancelled && h5) void applyContinuousFocus(h5)
        }, 1500)
      } catch (e) {
        if (!cancelled) {
          setErr(String(e?.message || e || 'Không mở được camera.'))
        }
      }
    }

    void run()

    return () => {
      cancelled = true
      if (focusTimer) window.clearTimeout(focusTimer)
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
          Đưa mã vào khung vuông giữa màn hình — giữ điện thoại cách vừa phải (iOS không lấy nét cận). Sau mỗi lần
          nhận có nghỉ ngắn. Bấm «Hủy» hoặc × để tắt camera.
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
