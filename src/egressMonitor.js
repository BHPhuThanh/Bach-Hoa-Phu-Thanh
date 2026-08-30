/**
 * Đo egress Supabase NGAY TRONG TRÌNH DUYỆT, không phụ thuộc báo cáo Supabase (vốn chỉ có độ phân
 * giải theo NGÀY — muốn biết trong ngày tính năng nào đang tốn nhiều thì phải đợi hôm sau).
 *
 * Cách làm: bọc `fetch` truyền cho `createClient({ global: { fetch } })` — mỗi response PostgREST
 * đo dung lượng qua header `Content-Length` (đúng bytes đã truyền qua mạng, kể cả khi có nén), gắn
 * nhãn theo tên bảng đọc từ URL (`/rest/v1/<table>`), gộp trong bộ nhớ rồi ghi ĐỊNH KỲ (không ghi
 * từng request — tự ghi log cũng tốn egress/ingress nếu ghi quá dày) lên bảng `egress_log`
 * (xem supabase/migrations/20260830160000_egress_log.sql — PHẢI chạy migration này trước, không thì
 * bước ghi log chỉ lỗi âm thầm, không phá gì khác).
 *
 * CHỦ ĐỘNG TÁCH RIÊNG khỏi supabaseClient.js (không import client dùng chung) để tránh vòng lặp
 * import (client cần fetch này lúc khởi tạo, module này lại cần ghi/đọc bảng) — module này tự gọi
 * PostgREST bằng fetch thô, dùng thẳng URL/anon key, y hệt cách supabaseClient.js lấy config.
 *
 * KHÔNG đo được kênh Realtime (WebSocket, không đi qua fetch) — theo pie chart Supabase, Realtime
 * thường chỉ ~1-2% tổng egress nên bỏ qua chấp nhận được.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const READY =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.trim().length > 0 &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.trim().length > 0

const EGRESS_TABLE = 'egress_log'
const EGRESS_DAILY_VIEW = 'egress_log_daily'
const FLUSH_INTERVAL_MS = 5 * 60 * 1000 // 5 phút — đủ mịn để thấy "hôm nay" gần như tức thời

let supabaseOrigin = null
try {
  supabaseOrigin = READY ? new URL(SUPABASE_URL).origin : null
} catch {
  supabaseOrigin = null
}

/** table_name -> { bytes, count } — dồn từ lần flush trước, xoá sau mỗi lần ghi thành công. */
const acc = new Map()

function addToAcc(table, bytes) {
  if (!table || !(bytes > 0)) return
  const cur = acc.get(table) || { bytes: 0, count: 0 }
  cur.bytes += bytes
  cur.count += 1
  acc.set(table, cur)
}

function tableNameFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl, window.location.href)
    if (!supabaseOrigin || u.origin !== supabaseOrigin) return null // chỉ đo đúng traffic Supabase
    const m = u.pathname.match(/\/rest\/v1\/(rpc\/[^/?]+|[^/?]+)/)
    if (m) return m[1]
    if (u.pathname.startsWith('/storage/')) return 'storage'
    return null // endpoint khác (vd. health check) — không đáng kể, bỏ qua cho gọn dữ liệu
  } catch {
    return null
  }
}

function trackResponse(rawUrl, res) {
  const table = tableNameFromUrl(rawUrl)
  if (!table || table === EGRESS_TABLE || table === EGRESS_DAILY_VIEW) return // đừng tự đếm log của chính nó
  const lenHeader = res.headers.get('content-length')
  const bytes = lenHeader ? Number(lenHeader) || 0 : 0
  if (bytes > 0) {
    addToAcc(table, bytes)
    return
  }
  // Không có Content-Length (chunked...) — hiếm với PostgREST, đo dự phòng bằng bản sao response,
  // không đụng tới response gốc mà app đang chờ đọc.
  res
    .clone()
    .text()
    .then((t) => addToAcc(table, t.length))
    .catch(() => {})
}

/**
 * Fetch để truyền vào `createClient({ global: { fetch } })`. Không bao giờ được làm hỏng luồng
 * chính — mọi lỗi đo đạc chỉ log cảnh báo, KHÔNG throw, KHÔNG đổi response trả về app.
 */
export function createEgressTrackingFetch(baseFetch = fetch) {
  if (!READY) return baseFetch
  return async function trackedFetch(input, init) {
    const res = await baseFetch(input, init)
    try {
      const rawUrl = typeof input === 'string' ? input : input?.url
      trackResponse(rawUrl, res)
    } catch (err) {
      console.warn('[egressMonitor] đo egress lỗi (bỏ qua):', err)
    }
    return res
  }
}

async function flush() {
  if (!READY || acc.size === 0) return
  const rows = []
  for (const [table_name, { bytes, count }] of acc) {
    if (bytes > 0) rows.push({ table_name, bytes, request_count: count })
  }
  acc.clear() // xoá trước khi ghi — mất 1 đợt nếu ghi lỗi mạng vẫn chấp nhận được, không đáng để retry phức tạp
  if (rows.length === 0) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${EGRESS_TABLE}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    })
  } catch (err) {
    console.warn('[egressMonitor] flush lỗi (bỏ qua, đợt sau vẫn đúng):', err)
  }
}

/**
 * Gọi 1 lần lúc app khởi động (main.jsx). Trả về hàm dọn dẹp (không thật sự cần gọi — sống theo
 * vòng đời tab — nhưng trả ra cho nhất quán với các hook khác trong repo).
 */
export function startEgressMonitorFlushing() {
  if (!READY) return () => {}
  const interval = window.setInterval(flush, FLUSH_INTERVAL_MS)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void flush()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', flush)
  return () => {
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', flush)
  }
}

/**
 * Đọc lịch sử đã gộp theo ngày (giờ Việt Nam) + bảng — dùng cho panel Admin. Ném lỗi khi tải thất
 * bại (kể cả khi CHƯA chạy migration egress_log — bảng/view không tồn tại) để UI tự hiện thông báo.
 * @param {number} days — số ngày gần nhất muốn xem (ước lượng qua limit, không lọc chính xác theo mốc).
 */
export async function fetchEgressDailySummary(days = 14) {
  if (!READY) return []
  const limit = Math.max(20, days * 12) // vài bảng/ngày là đủ dư, tránh đoán thiếu
  const url =
    `${SUPABASE_URL}/rest/v1/${EGRESS_DAILY_VIEW}` +
    `?select=day,table_name,bytes,request_count&order=day.desc&limit=${limit}`
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`fetchEgressDailySummary: HTTP ${res.status} ${body}`.trim())
  }
  return res.json()
}
