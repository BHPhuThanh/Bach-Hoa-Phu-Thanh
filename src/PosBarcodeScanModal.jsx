import { useEffect, useMemo, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { blurActiveElement, playScanSuccessBeep } from './scanFeedback.js'
import './barcodeScan.css'

/** Gộp hai lần đọc giống hệt trong một khung (html5-qrcode hay lặp). */
const SCAN_SAME_CODE_DEBOUNCE_MS = 400
/** Sau mỗi lần xử lý mã: không nhận mã mới trong khoảng này (camera vẫn mở). */
const SCAN_COOLDOWN_MS = 1200

/**
 * Khung chữ nhật ngang — mã vạch bán lẻ (EAN-13/UPC…) là hình chữ nhật dài, không phải hình
 * vuông. Thư viện chỉ giải mã đúng phần ảnh NẰM TRONG khung (crop trước khi decode) — khung
 * vuông trước đây cắt mất 2 đầu mã vạch nên dù ảnh nét vẫn không đọc được.
 */
const SCAN_QRBOX = { width: 300, height: 150 }

const SCAN_CONFIG_BASE = {
  fps: 10,
  qrbox: SCAN_QRBOX,
  // Không ép aspectRatio vuông — để khung xem giữ tỉ lệ ngang tự nhiên của camera, tận dụng hết
  // chiều rộng cho mã vạch dài thay vì bị crop vuông từ trước khi tới bước khoanh vùng qrbox.
  disableFlip: false,
}

/** Cấu hình flagship: ideal (không exact) + continuous focus khi trình duyệt hỗ trợ. */
function buildPosVideoConstraints({ includeContinuousFocus = true } = {}) {
  const constraints = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
  }
  if (includeContinuousFocus) {
    constraints.advanced = [{ focusMode: 'continuous' }]
  }
  return constraints
}

function isOverconstrainedError(err) {
  const name = String(err?.name ?? '')
  const msg = String(err?.message ?? err ?? '').toLowerCase()
  return (
    name === 'OverconstrainedError' ||
    name === 'NotSupportedError' ||
    name === 'ConstraintNotSatisfiedError' ||
    msg.includes('overconstrained') ||
    msg.includes('not supported') ||
    msg.includes('constraint')
  )
}

function pickRearCameraId(cameras) {
  const list = Array.isArray(cameras) ? cameras : []
  if (!list.length) return null
  const rear = list.find((c) => /back|rear|environment|sau/i.test(String(c?.label ?? '')))
  return (rear ?? list[list.length - 1])?.id ?? null
}

/** Ngắt mọi MediaStreamTrack trong viewport — tránh rò RAM trên máy cũ (Tab S7, iPad cũ). */
function stopMediaTracksInReader(readerId) {
  const root = document.getElementById(readerId)
  if (!root) return
  root.querySelectorAll('video').forEach((video) => {
    const stream = video.srcObject
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          /* ignore */
        }
      })
    }
    video.srcObject = null
    try {
      video.load()
    } catch {
      /* ignore */
    }
  })
}

async function releasePosCamera(h5, readerId) {
  if (h5) {
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
  stopMediaTracksInReader(readerId)
}

async function applyContinuousFocusSafe(h5) {
  if (!h5?.applyVideoConstraints) return
  try {
    await h5.applyVideoConstraints({
      advanced: [{ focusMode: 'continuous' }],
    })
  } catch {
    try {
      await h5.applyVideoConstraints({ focusMode: 'continuous' })
    } catch {
      /* Safari / máy cũ có thể không hỗ trợ — bỏ qua */
    }
  }
}

async function startPosScannerWithFallback(h5, readerId, onDecoded) {
  const noop = () => {}

  const attempts = [
    {
      label: 'ideal-720p-focus',
      run: () =>
        h5.start(
          { facingMode: { ideal: 'environment' } },
          {
            ...SCAN_CONFIG_BASE,
            videoConstraints: buildPosVideoConstraints({ includeContinuousFocus: true }),
          },
          onDecoded,
          noop
        ),
    },
    {
      label: 'ideal-720p',
      run: () =>
        h5.start(
          { facingMode: { ideal: 'environment' } },
          {
            ...SCAN_CONFIG_BASE,
            videoConstraints: buildPosVideoConstraints({ includeContinuousFocus: false }),
          },
          onDecoded,
          noop
        ),
    },
    {
      label: 'environment-basic',
      run: () => h5.start({ facingMode: 'environment' }, SCAN_CONFIG_BASE, onDecoded, noop),
    },
    {
      label: 'rear-device-id',
      run: async () => {
        const cams = await Html5Qrcode.getCameras()
        const deviceId = pickRearCameraId(cams)
        if (!deviceId) throw new Error('Không tìm thấy camera sau.')
        await h5.start(
          { deviceId: { ideal: deviceId } },
          {
            ...SCAN_CONFIG_BASE,
            videoConstraints: buildPosVideoConstraints({ includeContinuousFocus: false }),
          },
          onDecoded,
          noop
        )
      },
    },
    {
      label: 'first-camera-basic',
      run: async () => {
        const cams = await Html5Qrcode.getCameras()
        if (!cams?.length) throw new Error('Không tìm thấy camera.')
        await h5.start({ deviceId: { ideal: cams[0].id } }, SCAN_CONFIG_BASE, onDecoded, noop)
      },
    },
  ]

  let lastErr = null
  for (const attempt of attempts) {
    try {
      await attempt.run()
      return
    } catch (e) {
      lastErr = e
      if (!isOverconstrainedError(e) && attempt.label === 'ideal-720p-focus') {
        /* Lỗi khác (permission, …) — vẫn thử fallback */
      }
      await releasePosCamera(h5, readerId)
    }
  }
  throw lastErr ?? new Error('Không mở được camera.')
}

/**
 * Quét mã POS — tối ưu cleanup RAM + fallback constraints cho máy cũ.
 * Chỉ dùng tại tab Bán hàng; các tab khác giữ BarcodeScanModal.
 */
export default function PosBarcodeScanModal({ open, title = 'Quét mã vạch', onClose, onScan }) {
  const readerId = useMemo(() => `bhpt-pos-qr-${Math.random().toString(36).slice(2, 11)}`, [])
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  const lastScanRef = useRef({ text: '', at: 0 })
  const cooldownUntilRef = useRef(0)
  const h5Ref = useRef(null)
  const [err, setErr] = useState('')
  const [viewportFlash, setViewportFlash] = useState(false)

  onScanRef.current = onScan
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    let focusTimer = 0
    setErr('')
    lastScanRef.current = { text: '', at: 0 }
    cooldownUntilRef.current = 0
    h5Ref.current = null

    const run = async () => {
      let h5 = null
      try {
        h5 = new Html5Qrcode(readerId, { verbose: false })
        h5Ref.current = h5

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
            console.warn('[PosBarcodeScanModal] onScan', e)
          }

          cooldownUntilRef.current = Date.now() + SCAN_COOLDOWN_MS
        }

        await startPosScannerWithFallback(h5, readerId, onDecoded)
        focusTimer = window.setTimeout(() => {
          if (!cancelled && h5Ref.current) void applyContinuousFocusSafe(h5Ref.current)
        }, 1500)
      } catch (e) {
        if (!cancelled) {
          setErr(String(e?.message || e || 'Không mở được camera.'))
        }
        if (h5) {
          await releasePosCamera(h5, readerId)
          h5Ref.current = null
        }
      }
    }

    void run()

    return () => {
      cancelled = true
      if (focusTimer) window.clearTimeout(focusTimer)
      const h5 = h5Ref.current
      h5Ref.current = null
      stopMediaTracksInReader(readerId)
      void releasePosCamera(h5, readerId)
    }
  }, [open, readerId])

  if (!open) return null

  return (
    <div
      className="barcode-scan-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current?.()
      }}
    >
      <div className="barcode-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="pos-barcode-scan-title">
        <header className="barcode-scan-head">
          <h2 id="pos-barcode-scan-title" className="barcode-scan-title">
            {title}
          </h2>
          <button type="button" className="barcode-scan-close" aria-label="Đóng" onClick={() => onCloseRef.current?.()}>
            ×
          </button>
        </header>
        <p className="barcode-scan-hint">
          Đưa mã vào khung vuông giữa màn hình — giữ thiết bị cách vừa phải để lấy nét. Sau mỗi lần nhận có nghỉ ngắn.
          Bấm «Hủy» hoặc × để tắt camera.
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
          <button type="button" className="barcode-scan-btn barcode-scan-btn--ghost" onClick={() => onCloseRef.current?.()}>
            Hủy
          </button>
        </footer>
      </div>
    </div>
  )
}
