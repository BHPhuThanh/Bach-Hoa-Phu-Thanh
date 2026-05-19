/**
 * Ghi lịch sử phiếu nhập lên Supabase (`public.inbound_history`).
 *
 * Tên bảng cố định một chỗ — phải khớp migration; dùng underscore `inbound_history`,
 * không bao giờ dùng khoảng trắng (`inbound history`) hay tên CamelCase trong PostgREST.
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export const INBOUND_HISTORY_TABLE = 'inbound_history'

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
    const { data: newOrder, error } = await sb
      .from(INBOUND_HISTORY_TABLE)
      .insert(insertPayload)
      .select('id, created_at, order_code, payload')
      .single()

    if (error) {
      console.error('Lỗi tạo phiếu nhập:', error)
      return { ok: false, error }
    }

    const persisted =
      newOrder?.payload && typeof newOrder.payload === 'object'
        ? { ...newOrder.payload, code: newOrder.payload.code || newOrder.order_code }
        : payload

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
