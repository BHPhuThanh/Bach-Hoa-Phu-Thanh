/**
 * Phát hiện có bản build MỚI trên server (so với bản đang chạy trong tab) để nhắc tải lại.
 *
 * App này thường mở liên tục cả ngày (POS quầy thu ngân) — code JS đã tải vào tab KHÔNG tự đổi khi
 * có deploy mới, chỉ cập nhật khi tab thực sự tải lại (F5 / đóng mở lại). Từng gặp thật: fix egress
 * đã lên `main` từ trưa nhưng tab mở từ sáng vẫn âm thầm chạy bản cũ suốt buổi chiều, không ai biết
 * để tải lại. Module này bù đúng chỗ thiếu đó bằng cách tự dò bản mới rồi báo cho người dùng.
 *
 * Cách dò: `index.html` KHÔNG bị Service Worker cache (xem public/sw.js — chỉ cache JS/CSS/font),
 * nên fetch lại `index.html` (no-store) rồi so tên file bundle JS chính (Vite tự đổi hash tên file
 * mỗi lần build) với bundle đang chạy trong tab — khác nhau tức là có bản mới trên server.
 *
 * Ưu tiên mạnh cho di động: timer nền dễ bị hệ điều hành tạm dừng khi app xuống nền/khoá màn hình,
 * nên KHÔNG chỉ dựa vào setInterval — luôn dò lại ngay khi tab/app trở lại foreground
 * (visibilitychange), đúng lúc người dùng thật sự "chuyển qua lại" — cộng thêm tín hiệu
 * `controllerchange` của Service Worker làm lớp báo tức thời khi trình duyệt hỗ trợ.
 */
import { useEffect, useRef, useState } from 'react'

const MODULE_SRC_RE = /<script[^>]*type=["']module["'][^>]*\ssrc=["']([^"']+)["']/i
// 15 phút — chỉ cần đủ để không bỏ lỡ nguyên ca làm việc nếu tab không hề rời foreground, khỏi
// cộng thêm request thường xuyên (bản thân index.html rất nhỏ, không đáng ngại về egress).
const CHECK_INTERVAL_MS = 15 * 60 * 1000

function currentModuleScriptSrc() {
  return document.querySelector('script[type="module"]')?.getAttribute('src') || ''
}

async function fetchLatestModuleScriptSrc() {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  const res = await fetch(`${normalized}?_upd=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return ''
  const html = await res.text()
  return html.match(MODULE_SRC_RE)?.[1] || ''
}

/** @returns {boolean} true khi phát hiện bản mới trên server, khác bản đang chạy trong tab này. */
export function useAppUpdateAvailable() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const baselineRef = useRef('')
  const checkingRef = useRef(false)
  const foundRef = useRef(false)

  useEffect(() => {
    baselineRef.current = currentModuleScriptSrc()
    // Dev server (vite) trả về đúng 1 src cố định (/src/main.jsx, không hash) — sẽ không bao giờ
    // khác nhau, tự động vô hiệu tính năng này ở môi trường dev, đúng ý muốn.

    const markFound = () => {
      if (foundRef.current) return
      foundRef.current = true
      setUpdateAvailable(true)
    }

    const check = async () => {
      if (checkingRef.current || foundRef.current || !baselineRef.current) return
      checkingRef.current = true
      try {
        const latest = await fetchLatestModuleScriptSrc()
        if (latest && latest !== baselineRef.current) markFound()
      } catch {
        /* mất mạng / offline — bỏ qua, lần dò sau thử lại */
      } finally {
        checkingRef.current = false
      }
    }

    const firstTimer = window.setTimeout(check, 8000) // đợi app ổn định, khỏi cộng dồn lúc mới mở

    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') check()
    }, CHECK_INTERVAL_MS)

    let onControllerChange
    if ('serviceWorker' in navigator) {
      onControllerChange = () => markFound()
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    }

    return () => {
      window.clearTimeout(firstTimer)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      if (onControllerChange) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      }
    }
  }, [])

  return updateAvailable
}
