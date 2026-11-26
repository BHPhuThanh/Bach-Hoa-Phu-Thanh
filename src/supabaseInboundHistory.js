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
    ...(order.deleted === true
      ? { deleted: true, deletedAtMs: Number(order.deletedAtMs) || Date.now() }
      : {}),
  }
}

/** Phiếu đã bị "Xóa đơn nhập" (đánh dấu mềm trong payload — đồng bộ việc xóa sang mọi máy). */
export function isInboundHistoryPayloadDeleted(payload) {
  return payload != null && typeof payload === 'object' && payload.deleted === true
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
  const allowEmptyLines =
    payload.status === 'saved_temp' || payload.status === 'cancelled' || payload.deleted === true
  if (!Array.isArray(payload.lines) || (payload.lines.length === 0 && !allowEmptyLines)) {
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
 * Ghi phiếu lên `inbound_history` theo id phiếu (`payload->>id`): đã có → UPDATE đúng dòng đó,
 * chưa có → INSERT. Dùng cho mọi trạng thái (Lưu tạm, Hoàn thành, sửa phiếu…) — máy khác thấy
 * ngay, và phiếu Lưu tạm khi Hoàn thành sẽ cập nhật dòng cũ thay vì sinh thêm phiếu trùng.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: unknown, order?: object, dbRow?: object }>}
 */
export async function insertInboundHistoryEntry(order) {
  return upsertInboundHistoryEntry(order)
}

/** @see insertInboundHistoryEntry */
export async function upsertInboundHistoryEntry(order) {
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

  try {
    const newOrder = await withSupabaseRetry(async () => {
      // Tra cứu phải báo lỗi thật (không nuốt lỗi) — nếu không sẽ INSERT nhầm thành phiếu trùng.
      const found = await sb
        .from(INBOUND_HISTORY_TABLE)
        .select('id')
        .eq('payload->>id', payload.id)
        .order('created_at', { ascending: false })
        .limit(1)
      if (found.error) throw found.error
      const existingRow = Array.isArray(found.data) ? found.data[0] : null
      if (existingRow?.id) {
        // Không dùng `.single()`: khi UPDATE khớp 0 dòng (RLS/policy UPDATE trên DB thật chặn, hoặc
        // trigger huỷ) PostgREST trả 406 «Cannot coerce the result to a single JSON object».
        const upd = await sb
          .from(INBOUND_HISTORY_TABLE)
          .update(insertPayload)
          .eq('id', existingRow.id)
          .select('id, created_at, order_code, payload')
        if (upd.error) throw upd.error
        const updatedRow = Array.isArray(upd.data) ? upd.data[0] : null
        if (updatedRow) return updatedRow
        // UPDATE không ghi được dòng nào → ghi dòng mới cho phiếu (danh sách luôn lấy bản MỚI NHẤT
        // theo `payload->>id`, nên phiếu vẫn hiện đúng trạng thái trên mọi máy).
        console.warn(
          '[inbound_history] UPDATE không khớp dòng nào (kiểm tra policy UPDATE của bảng inbound_history) — ghi dòng mới thay thế.',
          { rowId: existingRow.id, orderId: payload.id }
        )
      }
      const res = await sb
        .from(INBOUND_HISTORY_TABLE)
        .insert(insertPayload)
        .select('id, created_at, order_code, payload')
      const insertedRow = Array.isArray(res.data) ? res.data[0] : null
      if (!res.error && insertedRow) return insertedRow
      // Trước khi retry: kiểm tra phiếu này đã tồn tại chưa (xem comment hàm tìm ở trên).
      const existing = await findInboundHistoryEntryByOrderId(sb, payload.id)
      if (existing) return existing
      throw res.error || new Error('Không ghi được phiếu vào «inbound_history» (máy chủ không trả về dòng nào).')
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
 * "Xóa đơn nhập": đánh dấu `payload.deleted = true` trên các dòng `inbound_history` theo id phiếu
 * (xóa mềm — mọi máy khi làm mới sẽ gỡ phiếu khỏi danh sách; dữ liệu vẫn còn để khôi phục khi cần).
 * Phiếu chưa từng lên máy chủ (chỉ có ở máy này) → bỏ qua, không lỗi.
 * @param {Iterable<string>} orderIds
 * @returns {Promise<{ ok: boolean, skipped?: boolean, marked?: number, error?: unknown }>}
 */
export async function markInboundHistoryEntriesDeleted(orderIds) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: new Error('Không tạo được Supabase client.') }
  const ids = [...new Set([...orderIds].map((x) => String(x ?? '').trim()).filter(Boolean))]
  if (ids.length === 0) return { ok: true, marked: 0 }
  try {
    let marked = 0
    const deletedAtMs = Date.now()
    for (const id of ids) {
      await withSupabaseRetry(async () => {
        const found = await sb
          .from(INBOUND_HISTORY_TABLE)
          .select('id, payload')
          .eq('payload->>id', id)
        if (found.error) throw found.error
        for (const row of found.data || []) {
          const p = row?.payload && typeof row.payload === 'object' ? row.payload : {}
          if (isInboundHistoryPayloadDeleted(p)) continue
          const upd = await sb
            .from(INBOUND_HISTORY_TABLE)
            .update({ payload: { ...p, deleted: true, deletedAtMs } })
            .eq('id', row.id)
          if (upd.error) throw upd.error
          marked += 1
        }
      })
    }
    bumpInboundSync()
    return { ok: true, marked }
  } catch (error) {
    console.error('Lỗi xóa phiếu nhập trên máy chủ:', error)
    return { ok: false, error }
  }
}

/**
 * Đọc danh sách phiếu nhập trực tiếp từ Supabase.
 * Mặc định (không truyền gì) tải toàn bộ tới `limit` dòng — chỉ dùng khi thật sự cần (vd export).
 * Trang "Nhập hàng" dùng `sinceMs`/`beforeMs` để giới hạn theo ngày (xem `refreshInboundInvoices`
 * / `loadOlderInboundInvoices` ở AdminHub.jsx) — tránh kéo cả lịch sử mỗi lần tải/làm mới.
 * @param {{ sinceMs?: number, beforeMs?: number, limit?: number }} [opts]
 * @returns {Promise<{ ok: boolean, rows?: Array<object>, skipped?: boolean, error?: unknown }>}
 */
export async function fetchInboundInvoices(opts = {}) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true, rows: [] }
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: new Error('Không tạo được Supabase client.') }
  const { sinceMs, beforeMs, limit = 2000 } = opts || {}
  try {
    let q = sb
      .from(INBOUND_HISTORY_TABLE)
      .select('payload, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (Number.isFinite(sinceMs)) q = q.gte('created_at', new Date(sinceMs).toISOString())
    if (Number.isFinite(beforeMs)) q = q.lt('created_at', new Date(beforeMs).toISOString())
    const { data, error } = await q
    if (error) return { ok: false, error }
    const all = (data || [])
      .map((r) => (r && typeof r.payload === 'object' ? r.payload : null))
      .filter(Boolean)
    // Phiếu đã xóa: không trả về như phiếu thường, nhưng báo id để máy này gỡ khỏi cache cục bộ.
    const rows = all.filter((p) => !isInboundHistoryPayloadDeleted(p))
    const deletedIds = all
      .filter((p) => isInboundHistoryPayloadDeleted(p))
      .map((p) => String(p.id ?? '').trim())
      .filter(Boolean)
    return { ok: true, rows, deletedIds }
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
    return p && typeof p === 'object' && !isInboundHistoryPayloadDeleted(p) ? p : null
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
    if (p && typeof p === 'object') return isInboundHistoryPayloadDeleted(p) ? null : p
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
    return p && typeof p === 'object' && !isInboundHistoryPayloadDeleted(p) ? p : null
  } catch (e) {
    console.warn('[inbound_history] getInboundOrderByCode', code, e)
    return null
  }
}
