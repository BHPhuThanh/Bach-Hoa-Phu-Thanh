import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import { getReportTimeWindow, isOrderInRange } from './reportUtils.js'

const IDB_DB_NAME = 'csv-preview-sales-v1'
const IDB_STORE = 'orders'
const IDB_VERSION = 1
const SALES_TABLE = 'sales'

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' })
      }
    }
  })
}

/**
 * @param {{ id: string, invoiceNo: string, createdAt: string, items: object[], subtotal: number, discount: number, total: number }} order
 */
export async function saveOrder(order) {
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const createdAt = order.createdAt || new Date().toISOString()
    const { error } = await sb.from(SALES_TABLE).upsert(
      {
        id: order.id,
        created_at: createdAt,
        payload: order,
      },
      { onConflict: 'id' }
    )
    if (error) throw error
    return { ok: true, id: order.id }
  }
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.oncomplete = () => resolve({ ok: true, id: order.id })
    tx.onerror = () => reject(tx.error)
    tx.objectStore(IDB_STORE).put(order)
  })
}

export class OrderSaveTimeoutError extends Error {
  constructor(ms) {
    super(`Lưu đơn quá ${ms}ms (timeout).`)
    this.name = 'OrderSaveTimeoutError'
    this.isTimeout = true
  }
}

/**
 * Bọc saveOrder bằng Promise.race + timeout để KHÔNG bao giờ treo UI khi mạng/Supabase phản hồi chậm.
 * Hết thời gian sẽ reject bằng OrderSaveTimeoutError (cờ isTimeout) — caller chuyển sang luồng OFFLINE.
 */
export function saveOrderWithTimeout(order, ms = 3000) {
  let timer = null
  const timeoutP = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OrderSaveTimeoutError(ms)), ms)
  })
  return Promise.race([saveOrder(order), timeoutP]).finally(() => {
    if (timer != null) clearTimeout(timer)
  })
}

/** Mới nhất trước — toàn bộ lịch sử (chỉ dùng khi thật sự cần, ví dụ POS gộp mã bán). */
export async function getAllOrders() {
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const { data, error } = await sb
      .from(SALES_TABLE)
      .select('payload, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    const list = (data || [])
      .map((row) => {
        const p = row.payload
        return p && typeof p === 'object' ? p : null
      })
      .filter(Boolean)
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return list
  }
  return fetchAllOrdersFromIdb()
}

async function fetchAllOrdersFromIdb() {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).getAll()
    req.onsuccess = () => {
      const list = req.result || []
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      resolve(list)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Lấy đơn trong cửa sổ báo cáo (Doanh thu / Đơn hàng) — query theo ngày trên Supabase, không kéo toàn bộ lịch sử.
 * @param {string} rangeKey — RANGE_* từ reportUtils
 * @param {string} [customFromYmd]
 * @param {string} [customToYmd]
 */
export async function getOrdersForReportRange(rangeKey, customFromYmd, customToYmd, now = new Date()) {
  const w = getReportTimeWindow(rangeKey, customFromYmd, customToYmd, now)
  if (!w) return []
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    // PostgREST giới hạn mặc định 1000 dòng/request nếu không .range() — khoảng ngày rộng (Tháng
    // này…) trên cửa hàng bán nhiều dễ vượt 1000 đơn, âm thầm THIẾU đơn (báo cáo sai) mà không có
    // lỗi gì báo ra. Phân trang lấy hết, không dừng sớm.
    const pageSize = 1000
    let from = 0
    const rows = []
    for (;;) {
      const { data, error } = await sb
        .from(SALES_TABLE)
        .select('payload, created_at')
        .gte('created_at', w.start.toISOString())
        .lte('created_at', w.end.toISOString())
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1)
      if (error) throw error
      const chunk = data || []
      rows.push(...chunk)
      if (chunk.length < pageSize) break
      from += pageSize
    }
    const list = rows
      .map((row) => {
        const p = row.payload
        return p && typeof p === 'object' ? p : null
      })
      .filter(Boolean)
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return list
  }
  const all = await fetchAllOrdersFromIdb()
  return all.filter((o) => isOrderInRange(o.createdAt, w.start, w.end))
}

/**
 * Lấy một đơn theo id — query đơn lẻ (đổi trả / deep-link), không tải toàn bộ lịch sử.
 * @param {string} orderIdRaw
 * @returns {Promise<object | null>}
 */
export async function getOrderById(orderIdRaw) {
  const orderId = String(orderIdRaw ?? '').trim()
  if (!orderId) return null
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const { data, error } = await sb.from(SALES_TABLE).select('*').eq('id', orderId).maybeSingle()
    if (error) throw error
    const p = data?.payload
    return p && typeof p === 'object' ? p : null
  }
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(orderId)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Lấy một đơn theo số hóa đơn (HD…) — query đơn lẻ, không tải toàn bộ lịch sử.
 * @param {string} invoiceNoRaw
 * @returns {Promise<object | null>}
 */
export async function getOrderByInvoiceNo(invoiceNoRaw) {
  const inv = String(invoiceNoRaw ?? '').trim()
  if (!inv) return null
  const invUpper = inv.toUpperCase()
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const { data, error } = await sb
      .from(SALES_TABLE)
      .select('payload')
      .eq('payload->>invoiceNo', inv)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    let p = data?.payload
    if (p && typeof p === 'object') return p
    const { data: rows, error: err2 } = await sb
      .from(SALES_TABLE)
      .select('payload')
      .ilike('payload->>invoiceNo', inv)
      .limit(5)
    if (err2) throw err2
    const hit = (rows || []).find(
      (row) => String(row?.payload?.invoiceNo ?? '').trim().toUpperCase() === invUpper
    )
    p = hit?.payload
    return p && typeof p === 'object' ? p : null
  }
  const all = await fetchAllOrdersFromIdb()
  return (
    all.find((o) => String(o?.invoiceNo ?? '').trim().toUpperCase() === invUpper) ?? null
  )
}

/**
 * N đơn mới nhất — modal đổi trả POS (vài KB), không getAllOrders.
 * @param {number} [limit]
 */
export async function getRecentOrders(limit = 6) {
  const n = Math.max(1, Math.min(20, Number(limit) || 6))
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const { data, error } = await sb
      .from(SALES_TABLE)
      .select('payload, created_at')
      .order('created_at', { ascending: false })
      .limit(n)
    if (error) throw error
    return (data || [])
      .map((row) => {
        const p = row.payload
        return p && typeof p === 'object' ? p : null
      })
      .filter(Boolean)
  }
  const all = await fetchAllOrdersFromIdb()
  return all.slice(0, n)
}

export async function clearAllOrders() {
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const { error } = await sb.from(SALES_TABLE).delete().neq('id', '')
    if (error) throw error
    return
  }
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(IDB_STORE).clear()
  })
}

export async function deleteOrderById(orderIdRaw) {
  const orderId = String(orderIdRaw || '').trim()
  if (!orderId) throw new Error('Thiếu orderId để xóa đơn hàng.')
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')

    // Bảng đơn thực tế đang được GET/LOAD ở Doanh thu: sales.
    const { error: salesErr } = await sb.from(SALES_TABLE).delete().eq('id', orderId)
    if (salesErr) throw salesErr
    return
  }

  const db = await openIdb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(IDB_STORE).delete(orderId)
  })
}
