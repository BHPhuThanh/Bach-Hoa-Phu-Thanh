/**
 * Thông báo Supabase (`public.notifications`).
 */

import { flattenDisplayCatalogToVariants } from './catalogRepository.js'
import { formatRoundedStockQtyVi } from './displayStockQty.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export const NOTIFICATIONS_TABLE = 'notifications'
export const NOTIFICATIONS_BUMP_EVENT = 'csv-preview:notifications-supabase-bump'

export const NOTIFICATION_KIND_LOW_STOCK = 'low_stock'

export const LOW_STOCK_DIGEST_HEADER = '📋 DANH SÁCH SẢN PHẨM CHẠM ĐÁY TỒN KHO NAY:'

function bump() {
  try {
    window.dispatchEvent(new Event(NOTIFICATIONS_BUMP_EVENT))
  } catch {
    /* ignore */
  }
}

function startOfTodayIso() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
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
    message: String(row.message ?? ''),
    is_read: !!row.is_read,
    createdAtMs: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    userId: row.user_id != null ? String(row.user_id) : null,
  }
}

/**
 * @typedef {{ id: string, kind: string, variantId: string, code: string, message: string, is_read: boolean, createdAtMs: number, userId: string | null }} AppNotificationRow
 */

/**
 * @param {string} code
 * @param {string} name
 * @param {number} stock
 */
export function formatLowStockDigestLine(code, name, stock) {
  const c = String(code ?? '').trim() || '—'
  const n = String(name ?? '').trim() || '—'
  const q = formatRoundedStockQtyVi(stock)
  return `- [${c}] ${n} (Còn: ${q})`
}

/**
 * @param {string} message
 * @param {string} code
 * @param {string} [name]
 */
export function messageContainsProductLine(message, code, name) {
  const c = String(code ?? '').trim()
  if (!c) return false
  const msg = String(message ?? '')
  if (msg.includes(`[${c}]`)) return true
  const n = String(name ?? '').trim()
  if (n && n !== '—' && msg.includes(n) && msg.includes(c)) return true
  return false
}

/**
 * @param {string} [userId]
 * @returns {Promise<AppNotificationRow | null>}
 */
export async function fetchTodayLowStockDigestNotification(userId) {
  if (!isSupabaseConfigured()) return null
  const client = getSupabaseClient()
  if (!client) return null

  const start = startOfTodayIso()
  const uid = String(userId ?? '').trim()

  const runQuery = (withDigestHeader) => {
    let q = client
      .from(NOTIFICATIONS_TABLE)
      .select('id, created_at, user_id, kind, variant_id, product_code, message, is_read')
      .eq('kind', NOTIFICATION_KIND_LOW_STOCK)
      .gte('created_at', start)
      .order('created_at', { ascending: true })
      .limit(1)
    if (withDigestHeader) {
      q = q.ilike('message', '%DANH SÁCH SẢN PHẨM CHẠM ĐÁY TỒN KHO NAY%')
    }
    if (uid) {
      q = q.or(`user_id.eq.${uid},user_id.is.null`)
    }
    return q
  }

  for (const withHeader of [true, false]) {
    const { data, error } = await runQuery(withHeader)
    if (error) {
      console.warn('[notifications] fetchTodayDigest', error)
      return null
    }
    const row = data?.[0]
    if (row) return mapNotificationRow(row)
  }

  return null
}

/**
 * @param {string} id
 * @param {string} message
 * @returns {Promise<AppNotificationRow | null>}
 */
export async function updateLowStockDigestNotification(id, message) {
  if (!isSupabaseConfigured()) return null
  const client = getSupabaseClient()
  if (!client) return null

  const sid = String(id ?? '').trim()
  const msg = String(message ?? '')
  if (!sid || !msg) return null

  const { data, error } = await client
    .from(NOTIFICATIONS_TABLE)
    .update({ message: msg, is_read: false })
    .eq('id', sid)
    .select()
    .single()

  if (error) {
    console.warn('[notifications] updateDigest', error)
    return null
  }
  bump()
  return mapNotificationRow(data)
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
 * @param {{ message: string, userId?: string }} row
 * @returns {Promise<AppNotificationRow | null>}
 */
export async function insertLowStockDigestNotification({ message, userId }) {
  if (!isSupabaseConfigured()) return null
  const client = getSupabaseClient()
  if (!client) return null

  const msg = String(message ?? '')
  if (!msg) return null

  const payload = {
    kind: NOTIFICATION_KIND_LOW_STOCK,
    variant_id: null,
    product_code: null,
    message: msg,
    is_read: false,
    user_id: String(userId ?? '').trim() || null,
  }

  const { data, error } = await client.from(NOTIFICATIONS_TABLE).insert(payload).select().single()
  if (error) {
    console.warn('[notifications] insertDigest', error)
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
 * Gom tất cả SP chạm đáy trong lần kiểm tra vào tối đa 1 thông báo / ngày.
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

  /** @type {Array<{ code: string, name: string, stock: number, variantId: string }>} */
  const candidates = []
  const seenCode = new Set()

  for (const rawVid of touchedVariantIds) {
    const vid = String(rawVid ?? '').trim()
    if (!vid) continue

    const v = byId.get(vid)
    if (!v) continue

    const min = variantStockNormMin(v)
    if (min == null) continue

    const stock = variantStockQty(v)
    if (stock > min) continue

    const code = String(v.code ?? '').trim()
    const codeKey = code.toLowerCase() || vid
    if (seenCode.has(codeKey)) continue
    seenCode.add(codeKey)

    const name = String(v.name ?? v.nameRaw ?? v.code ?? '').trim() || '—'
    candidates.push({ code, name, stock, variantId: vid })
  }

  if (!candidates.length) return []

  let digest = await fetchTodayLowStockDigestNotification(userId)
  let message = String(digest?.message ?? '').trim()
  if (digest && message && !message.includes('DANH SÁCH SẢN PHẨM CHẠM ĐÁY TỒN KHO NAY')) {
    message = `${LOW_STOCK_DIGEST_HEADER}\n${message}`
  }
  let changed = false

  for (const item of candidates) {
    if (messageContainsProductLine(message, item.code, item.name)) continue
    const line = formatLowStockDigestLine(item.code, item.name, item.stock)
    if (!message) {
      message = `${LOW_STOCK_DIGEST_HEADER}\n${line}`
    } else {
      message = `${message}\n${line}`
    }
    changed = true
  }

  if (!changed) {
    return digest ? [digest] : []
  }

  if (digest) {
    const updated = await updateLowStockDigestNotification(digest.id, message)
    return updated ? [updated] : []
  }

  const inserted = await insertLowStockDigestNotification({ message, userId })
  return inserted ? [inserted] : []
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
