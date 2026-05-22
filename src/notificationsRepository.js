/**
 * Thông báo Supabase (`public.notifications`).
 */

import { flattenDisplayCatalogToVariants } from './catalogRepository.js'
import { formatRoundedStockQtyVi } from './displayStockQty.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export const NOTIFICATIONS_TABLE = 'notifications'
export const NOTIFICATIONS_BUMP_EVENT = 'csv-preview:notifications-supabase-bump'

export const NOTIFICATION_KIND_LOW_STOCK = 'low_stock'

function bump() {
  try {
    window.dispatchEvent(new Event(NOTIFICATIONS_BUMP_EVENT))
  } catch {
    /* ignore */
  }
}

/**
 * @param {object} row
 * @returns {import('./notificationsRepository.js').AppNotificationRow | null}
 */
export function mapNotificationRow(row) {
  if (!row || row.id == null) return null
  return {
    id: String(row.id),
    kind: String(row.kind || 'general').trim() || 'general',
    variantId: String(row.variant_id ?? '').trim(),
    code: String(row.product_code ?? '').trim(),
    message: String(row.message ?? '').trim(),
    is_read: !!row.is_read,
    createdAtMs: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    userId: row.user_id != null ? String(row.user_id) : null,
  }
}

/**
 * @typedef {{ id: string, kind: string, variantId: string, code: string, message: string, is_read: boolean, createdAtMs: number, userId: string | null }} AppNotificationRow
 */

/**
 * @param {string} [userId]
 * @returns {Promise<AppNotificationRow[]>}
 */
export async function fetchNotificationsFromSupabase(userId) {
  if (!isSupabaseConfigured()) return []
  const client = getSupabaseClient()
  if (!client) return []

  let q = client
    .from(NOTIFICATIONS_TABLE)
    .select('id, created_at, user_id, kind, variant_id, product_code, message, is_read')
    .order('created_at', { ascending: false })
    .limit(80)

  const uid = String(userId ?? '').trim()
  if (uid) {
    q = q.or(`user_id.eq.${uid},user_id.is.null`)
  }

  const { data, error } = await q
  if (error) {
    console.warn('[notifications] fetch', error)
    return []
  }
  return (data || []).map(mapNotificationRow).filter(Boolean)
}

/**
 * @param {string} [userId]
 * @returns {Promise<{ ok: boolean, error?: unknown }>}
 */
export async function markAllNotificationsReadInSupabase(userId) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const client = getSupabaseClient()
  if (!client) return { ok: true, skipped: true }

  let q = client.from(NOTIFICATIONS_TABLE).update({ is_read: true }).eq('is_read', false)
  const uid = String(userId ?? '').trim()
  if (uid) {
    q = q.or(`user_id.eq.${uid},user_id.is.null`)
  }

  const { error } = await q
  if (error) {
    console.warn('[notifications] markAllRead', error)
    return { ok: false, error }
  }
  bump()
  return { ok: true }
}

/**
 * @param {{ variantId: string, userId?: string }} params
 */
export async function hasUnreadLowStockNotificationToday({ variantId, userId }) {
  if (!isSupabaseConfigured()) return false
  const client = getSupabaseClient()
  if (!client) return false

  const vid = String(variantId ?? '').trim()
  if (!vid) return false

  const start = new Date()
  start.setHours(0, 0, 0, 0)

  let q = client
    .from(NOTIFICATIONS_TABLE)
    .select('id')
    .eq('kind', NOTIFICATION_KIND_LOW_STOCK)
    .eq('is_read', false)
    .eq('variant_id', vid)
    .gte('created_at', start.toISOString())
    .ilike('message', '%chạm đáy%')
    .limit(1)

  const uid = String(userId ?? '').trim()
  if (uid) {
    q = q.or(`user_id.eq.${uid},user_id.is.null`)
  }

  const { data, error } = await q
  if (error) {
    console.warn('[notifications] hasUnreadLowStockToday', error)
    return false
  }
  return (data?.length ?? 0) > 0
}

/**
 * @param {{ variantId?: string, productCode?: string, message: string, userId?: string, kind?: string }} row
 * @returns {Promise<AppNotificationRow | null>}
 */
export async function insertNotificationRow(row) {
  if (!isSupabaseConfigured()) return null
  const client = getSupabaseClient()
  if (!client) return null

  const message = String(row.message ?? '').trim()
  if (!message) return null

  const payload = {
    kind: String(row.kind ?? NOTIFICATION_KIND_LOW_STOCK).trim() || NOTIFICATION_KIND_LOW_STOCK,
    variant_id: String(row.variantId ?? '').trim() || null,
    product_code: String(row.productCode ?? '').trim() || null,
    message,
    is_read: false,
    user_id: String(row.userId ?? '').trim() || null,
  }

  const { data, error } = await client.from(NOTIFICATIONS_TABLE).insert(payload).select().single()
  if (error) {
    console.warn('[notifications] insert', error)
    return null
  }
  bump()
  return mapNotificationRow(data)
}

export function variantStockNormMin(v) {
  const tnRaw = v?.raw?.ton_nho_nhat ?? v?.ton_nho_nhat ?? v?.stockNormMin
  if (tnRaw == null) return null
  if (typeof tnRaw === 'string' && tnRaw.trim() === '') return null
  const tn = Number(tnRaw)
  return Number.isFinite(tn) && tn >= 0 ? tn : null
}

export function variantStockQty(v) {
  const tkRaw = v?.raw?.ton_kho ?? v?.ton_kho ?? v?.stockQty
  const n = Number(tkRaw)
  return Number.isFinite(n) ? n : 0
}

/**
 * Sau bán hàng: tạo thông báo tồn thấp (chống spam 1 lần/ngày/variant).
 * @param {{ catalog: object[], touchedVariantIds: Iterable<string>, userId?: string }} params
 * @returns {Promise<AppNotificationRow[]>}
 */
export async function evaluateLowStockNotificationsAfterSale({
  catalog,
  touchedVariantIds,
  userId,
}) {
  if (!isSupabaseConfigured() || !catalog?.length) return []

  const byId = new Map(
    flattenDisplayCatalogToVariants(catalog).map((v) => [String(v.id), v])
  )
  const created = []
  const seenVariant = new Set()

  for (const rawVid of touchedVariantIds) {
    const vid = String(rawVid ?? '').trim()
    if (!vid || seenVariant.has(vid)) continue
    seenVariant.add(vid)

    const v = byId.get(vid)
    if (!v) continue

    const min = variantStockNormMin(v)
    if (min == null) continue

    const stock = variantStockQty(v)
    if (stock > min) continue

    const already = await hasUnreadLowStockNotificationToday({ variantId: vid, userId })
    if (already) continue

    const name = String(v.name ?? v.nameRaw ?? v.code ?? '').trim() || '—'
    const code = String(v.code ?? '').trim()
    const qtyLabel = formatRoundedStockQtyVi(stock)
    const message = `Sản phẩm ${name} đã chạm đáy tồn kho an toàn (Còn lại: ${qtyLabel}). Hãy nhập thêm hàng!`

    const inserted = await insertNotificationRow({
      variantId: vid,
      productCode: code,
      message,
      userId,
      kind: NOTIFICATION_KIND_LOW_STOCK,
    })
    if (inserted) created.push(inserted)
  }

  return created
}

/**
 * Chạy nền — không chặn luồng bán hàng / lưu kho.
 * @param {{ catalog: object[], touchedVariantIds: Iterable<string>, userId?: string }} params
 * @param {(rows: AppNotificationRow[]) => void} [onCreated]
 */
export function runLowStockAlertsInBackground({ catalog, touchedVariantIds, userId }, onCreated) {
  if (!isSupabaseConfigured() || !catalog?.length) return
  void evaluateLowStockNotificationsAfterSale({ catalog, touchedVariantIds, userId })
    .then((rows) => {
      if (rows?.length) onCreated?.(rows)
    })
    .catch((err) => {
      console.warn('[notifications] low stock background', err)
    })
}
