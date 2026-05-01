/**
 * Ghi lịch sử phiếu nhập lên Supabase (`public.inbound_history`).
 *
 * Tên bảng cố định một chỗ — phải khớp migration; dùng underscore `inbound_history`,
 * không bao giờ dùng khoảng trắng (`inbound history`) hay tên CamelCase trong PostgREST.
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export const INBOUND_HISTORY_TABLE = 'inbound_history'

function snapshotInboundOrderForHistory(order) {
  if (!order || typeof order !== 'object') return {}
  const lines = Array.isArray(order.lines) ? order.lines : []
  return {
    id: String(order.id ?? ''),
    code: String(order.code ?? ''),
    createdAtMs: order.createdAtMs != null ? Number(order.createdAtMs) : null,
    supplier: String(order.supplier ?? ''),
    status: String(order.status ?? ''),
    totalValue: order.totalValue != null ? order.totalValue : null,
    goodsSubtotal: order.goodsSubtotal != null ? order.goodsSubtotal : null,
    note: String(order.note ?? ''),
    orderDiscountMode: order.orderDiscountMode ?? null,
    orderDiscountValue: order.orderDiscountValue != null ? order.orderDiscountValue : null,
    lines: lines.map((ln) => ({ ...ln })),
  }
}

/**
 * Chèn một dòng sau khi đã cập nhật `products` thành công.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: unknown }>}
 */
export async function insertInboundHistoryEntry(order) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb) {
    return { ok: false, error: new Error('Không tạo được Supabase client.') }
  }
  const payload = snapshotInboundOrderForHistory(order)
  const order_code = String(order?.code ?? '').trim() || '_'
  try {
    const { error } = await sb.from(INBOUND_HISTORY_TABLE).insert({ order_code, payload })
    if (error) return { ok: false, error }
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}
