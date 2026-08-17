/**
 * Ghi lịch sử phiếu nhập lên Supabase (`public.inbound_history`).
 *
 * Tên bảng cố định một chỗ — phải khớp migration; dùng underscore `inbound_history`,
 * không bao giờ dùng khoảng trắng (`inbound history`) hay tên CamelCase trong PostgREST.
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import { withSupabaseRetry } from './supabaseRetry.js'

export const INBOUND_HISTORY_TABLE = 'inbound_history'
export const INBOUND_SYNC_BUMP_EVENT = 'csv-preview-inbound-sync-bump-v1'

export function bumpInboundSync() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(INBOUND_SYNC_BUMP_EVENT))
}

/** Loại bỏ `undefined` (PostgREST/json có thể drop hoặc lỗi ngầm). */
export function stripUndefinedDeep(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined)
  }
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      const next = stripUndefinedDeep(v)
      if (next !== undefined) out[k] = next
    }
    return out
  }
  return value
}

function snapshotInboundOrderForHistory(order) {
  if (!order || typeof order !== 'object') return {}
  const lines = Array.isArray(order.lines) ? order.lines : []
  return {
    id: String(order.id ?? ''),
    code: String(order.code ?? '').trim(),
    createdAtMs: order.createdAtMs != null ? Number(order.createdAtMs) : Date.now(),
    supplier: String(order.supplier ?? '').trim(),
    status: String(order.status ?? 'completed'),
    totalValue: order.totalValue != null ? Number(order.totalValue) : 0,
    goodsSubtotal:
      order.goodsSubtotal != null ? Number(order.goodsSubtotal) : Number(order.totalValue) || 0,
    note: String(order.note ?? ''),
    orderDiscountMode: order.orderDiscountMode === 'percent' ? 'percent' : 'amount',
    orderDiscountValue: order.orderDiscountValue != null ? Number(order.orderDiscountValue) : 0,
    lines: lines.map((ln) => stripUndefinedDeep({ ...ln })),
  }
}

/**
 * Kiểm tra payload trước khi insert — tránh Supabase từ chối ngầm.
 * @returns {{ ok: true } | { ok: false, error: Error }}
 */
export function validateInboundHistoryPayload(order) {
  const payload = stripUndefinedDeep(snapshotInboundOrderForHistory(order))
  const order_code = String(order?.code ?? payload.code ?? '').trim()
  if (!order_code) {
    return { ok: false, error: new Error('Thiếu mã phiếu nhập (order_code).') }
  }
  if (!payload.id) {
    return { ok: false, error: new Error('Thiếu id phiếu nhập trong payload.') }
  }
  if (!payload.supplier) {
    return { ok: false, error: new Error('Thiếu nhà cung cấp (supplier) trong payload.') }
  }
  if (!Number.isFinite(payload.createdAtMs)) {
    return { ok: false, error: new Error('Thiếu hoặc sai ngày tạo phiếu (createdAtMs).') }
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    return { ok: false, error: new Error('Phiếu nhập phải có ít nhất một dòng hàng (lines).') }
  }
  return { ok: true, payload, order_code }
}

/**
 * Tìm phiếu đã ghi theo `payload->>id` (id sinh ở client, ổn định qua các lần thử) — dùng để
 * kiểm tra "đã ghi thành công chưa" trước khi retry insert, tránh tạo trùng phiếu khi lần gọi
 * trước thật ra đã thành công trên server nhưng phản hồi bị rớt mạng.
 */
async function findInboundHistoryEntryByOrderId(sb, orderId) {
  const id = String(orderId ?? '').trim()
  if (!id) return null
  try {
    const { data, error } = await sb
      .from(INBOUND_HISTORY_TABLE)
      .select('id, created_at, order_code, payload')
      .eq('payload->>id', id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error || !Array.isArray(data) || data.length === 0) return null
    return data[0]
  } catch {
    return null
  }
}

/**
 * Chèn một dòng sau khi đã cập nhật `products` thành công.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: unknown, order?: object, dbRow?: object }>}
 */
export async function insertInboundHistoryEntry(order) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true, order }
  const sb = getSupabaseClient()
  if (!sb) {
    const error = new Error('Không tạo được Supabase client.')
    console.error('Lỗi tạo phiếu nhập:', error)
    return { ok: false, error }
  }

  const validated = validateInboundHistoryPayload(order)
  if (!validated.ok) {
    console.error('Lỗi tạo phiếu nhập:', validated.error)
    return { ok: false, error: validated.error }
  }

  const { payload, order_code } = validated
  const insertPayload = stripUndefinedDeep({ order_code, payload })
  // eslint-disable-next-line no-console -- xác minh payload trước khi gửi Supabase
  console.log('Payload chuẩn bị gửi:', insertPayload)

  try {
    const newOrder = await withSupabaseRetry(async () => {
      const res = await sb
        .from(INBOUND_HISTORY_TABLE)
        .insert(insertPayload)
        .select('id, created_at, order_code, payload')
        .single()
      if (!res.error) return res.data
      // Trước khi retry: kiểm tra phiếu này đã tồn tại chưa (xem comment hàm tìm ở trên).
      const existing = await findInboundHistoryEntryByOrderId(sb, payload.id)
      if (existing) return existing
      throw res.error
    })

    const persisted =
      newOrder?.payload && typeof newOrder.payload === 'object'
        ? { ...newOrder.payload, code: newOrder.payload.code || newOrder.order_code }
        : payload

    bumpInboundSync()
    return { ok: true, order: persisted, dbRow: newOrder }
  } catch (error) {
    console.error('Lỗi tạo phiếu nhập:', error)
    return { ok: false, error }
  }
}

/**
 * Đọc danh sách phiếu nhập trực tiếp từ Supabase.
 * @returns {Promise<{ ok: boolean, rows?: Array<object>, skipped?: boolean, error?: unknown }>}
 */
export async function fetchInboundInvoices() {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true, rows: [] }
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: new Error('Không tạo được Supabase client.') }
  try {
    const { data, error } = await sb
      .from(INBOUND_HISTORY_TABLE)
      .select('payload, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error) return { ok: false, error }
    const rows = (data || [])
      .map((r) => (r && typeof r.payload === 'object' ? r.payload : null))
      .filter(Boolean)
    return { ok: true, rows }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * Lấy một phiếu nhập theo id — query đơn lẻ (deep-link / lịch sử kho), không fetch toàn bộ.
 * @param {string} orderIdRaw
 * @returns {Promise<object | null>}
 */
export async function getInboundOrderById(orderIdRaw) {
  const orderId = String(orderIdRaw ?? '').trim()
  if (!orderId || !isSupabaseConfigured()) return null
  const sb = getSupabaseClient()
  if (!sb) return null
  try {
    const { data, error } = await sb
      .from(INBOUND_HISTORY_TABLE)
      .select('payload')
      .eq('payload->>id', orderId)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    const p = data?.payload
    return p && typeof p === 'object' ? p : null
  } catch (e) {
    console.warn('[inbound_history] getInboundOrderById', orderId, e)
    return null
  }
}

/**
 * Lấy một phiếu nhập theo mã (PN… / NH…) — query đơn lẻ.
 * @param {string} codeRaw
 * @returns {Promise<object | null>}
 */
export async function getInboundOrderByCode(codeRaw) {
  const code = String(codeRaw ?? '').trim()
  if (!code || !isSupabaseConfigured()) return null
  const sb = getSupabaseClient()
  if (!sb) return null
  try {
    const { data, error } = await sb
      .from(INBOUND_HISTORY_TABLE)
      .select('payload')
      .eq('order_code', code)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    let p = data?.payload
    if (p && typeof p === 'object') return p
    const { data: rows, error: err2 } = await sb
      .from(INBOUND_HISTORY_TABLE)
      .select('payload')
      .ilike('order_code', code)
      .limit(5)
    if (err2) throw err2
    const codeUpper = code.toUpperCase()
    const hit = (rows || []).find(
      (row) => String(row?.payload?.code ?? row?.payload?.order_code ?? '').trim().toUpperCase() === codeUpper
    )
    p = hit?.payload
    return p && typeof p === 'object' ? p : null
  } catch (e) {
    console.warn('[inbound_history] getInboundOrderByCode', code, e)
    return null
  }
}
