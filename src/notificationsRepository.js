/**
 * Thông báo Supabase (`public.notifications`).
 */

import { formatRoundedStockQtyVi } from './displayStockQty.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export const NOTIFICATIONS_TABLE = 'notifications'
export const NOTIFICATIONS_BUMP_EVENT = 'csv-preview:notifications-supabase-bump'

export const NOTIFICATION_KIND_LOW_STOCK = 'low_stock'

/** @deprecated Legacy header — dùng formatLowStockDigestHeader() cho thông báo mới. */
export const LOW_STOCK_DIGEST_HEADER = '📋 DANH SÁCH SẢN PHẨM CHẠM ĐÁY TỒN KHO NAY:'

/**
 * Tiêu đề digest theo ngày: [Ngày dd/mm/yyyy] - Danh sách sản phẩm sắp hết hàng
 * @param {Date} [date]
 */
export function formatLowStockDigestHeader(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `[Ngày ${dd}/${mm}/${yyyy}] - Danh sách sản phẩm sắp hết hàng`
}

/** Nhận diện message digest tồn thấp (header mới hoặc legacy). */
export function isLowStockDigestMessage(message) {
  const msg = String(message ?? '')
  return (
    msg.includes('Danh sách sản phẩm sắp hết hàng') ||
    msg.includes('DANH SÁCH SẢN PHẨM CHẠM ĐÁY TỒN KHO NAY')
  )
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatNotificationDayLabel(ms) {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return 'Khác'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  if (day.getTime() === today.getTime()) return 'Hôm nay'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day.getTime() === yesterday.getTime()) return 'Hôm qua'
  return `[Ngày ${dd}/${mm}/${yyyy}]`
}

/**
 * Gom thông báo theo ngày (mới nhất trước).
 * @param {AppNotificationRow[]} rows
 * @returns {Array<{ label: string, dayKey: string, items: AppNotificationRow[] }>}
 */
export function groupNotificationsByDay(rows) {
  if (!Array.isArray(rows) || !rows.length) return []
  const sorted = [...rows].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
  /** @type {Array<{ label: string, dayKey: string, items: AppNotificationRow[] }>} */
  const groups = []
  for (const n of sorted) {
    const d = new Date(n.createdAtMs || Date.now())
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const label = formatNotificationDayLabel(n.createdAtMs)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === dayKey) {
      last.items.push(n)
    } else {
      groups.push({ label, dayKey, items: [n] })
    }
  }
  return groups
}

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
 * Bóc tách dòng trong digest tồn thấp: `- [MÃ] Tên (Còn: X)`.
 * @param {string} message
 * @returns {Array<{ code: string, name: string, stockLabel: string }>}
 */
export function parseLowStockDigestMessage(message) {
  const items = []
  for (const raw of String(message ?? '').split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('-')) continue
    const m = line.match(/^-\s*\[([^\]]+)\]\s*(.+?)\s*\(Còn:\s*([^)]+)\)\s*$/)
    if (m) {
      items.push({
        code: m[1].trim(),
        name: m[2].trim(),
        stockLabel: m[3].trim(),
      })
    }
  }
  return items
}

/**
 * Khớp mã digest với catalog để lấy product + variant.
 * @param {Array} products
 * @param {Array<{ code: string }>} parsedItems
 */
export function resolveLowStockItemsFromCatalog(products, parsedItems) {
  if (!Array.isArray(products) || !Array.isArray(parsedItems)) return []
  const out = []
  const seen = new Set()
  for (const item of parsedItems) {
    const needle = String(item.code ?? '').trim().toLowerCase()
    if (!needle || seen.has(needle)) continue
    for (const p of products) {
      const vars = Array.isArray(p?.groupVariants) && p.groupVariants.length ? p.groupVariants : [p]
      const v = vars.find((x) => String(x?.code ?? '').trim().toLowerCase() === needle)
      if (v) {
        seen.add(needle)
        out.push({
          code: String(v.code ?? item.code ?? '').trim(),
          name: String(p.name || v.name || item.name || '').trim(),
          stockLabel: item.stockLabel,
          product: p,
          variant: v,
        })
        break
      }
    }
  }
  return out
}

/**
 * Quét catalog: ton_kho <= ton_nho_nhat (stockNormMin).
 * @param {Array} products
 */
export function collectLowStockProductsFromCatalog(products) {
  if (!Array.isArray(products)) return []
  const out = []
  const seen = new Set()
  for (const p of products) {
    const vars = Array.isArray(p?.groupVariants) && p.groupVariants.length ? p.groupVariants : [p]
    for (const v of vars) {
      const code = String(v?.code ?? '').trim()
      if (!code) continue
      const key = code.toLowerCase()
      if (seen.has(key)) continue
      const min = Number(v.stockNormMin ?? v.ton_nho_nhat)
      const stock = Number(v.stockQty ?? v.ton_kho ?? v.stock)
      if (!Number.isFinite(min) || min <= 0) continue
      if (!Number.isFinite(stock) || stock > min) continue
      seen.add(key)
      out.push({
        code,
        name: String(p.name || v.name || '').trim() || code,
        stockLabel: formatRoundedStockQtyVi(stock),
        product: p,
        variant: v,
      })
    }
  }
  return out
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
      q = q.or(
        'message.ilike.%Danh sách sản phẩm sắp hết hàng%,message.ilike.%DANH SÁCH SẢN PHẨM CHẠM ĐÁY TỒN KHO NAY%'
      )
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
 * Dựng nội dung digest đầy đủ từ danh sách sản phẩm tồn thấp.
 * @param {Array<{ code: string, name: string, stockLabel?: string, variant?: object }>} items
 * @param {Date} [date]
 */
export function buildLowStockDigestMessageFromItems(items, date = new Date()) {
  if (!Array.isArray(items) || !items.length) return ''
  const header = formatLowStockDigestHeader(date)
  const lines = items.map((it) => {
    const stock =
      it.variant != null
        ? variantStockQty(it.variant)
        : Number(String(it.stockLabel ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'))
    const stockN = Number.isFinite(stock) ? stock : 0
    return formatLowStockDigestLine(it.code, it.name, stockN)
  })
  return `${header}\n${lines.join('\n')}`
}

/**
 * Đồng bộ digest hôm nay — lũy kế toàn bộ SP còn tồn thấp trong catalog.
 * @param {object[]} catalog
 * @param {string} [userId]
 * @returns {Promise<AppNotificationRow[]>}
 */
export async function syncTodayLowStockDigest(catalog, userId) {
  if (!isSupabaseConfigured() || !catalog?.length) return []

  const items = collectLowStockProductsFromCatalog(catalog)
  if (!items.length) return []

  const message = buildLowStockDigestMessageFromItems(items)
  if (!message) return []

  let digest = await fetchTodayLowStockDigestNotification(userId)
  if (digest) {
    if (String(digest.message ?? '').trim() === message.trim()) return [digest]
    const updated = await updateLowStockDigestNotification(digest.id, message)
    return updated ? [updated] : []
  }

  const inserted = await insertLowStockDigestNotification({ message, userId })
  return inserted ? [inserted] : []
}

/**
 * Xóa thông báo cũ hơn 7 ngày (RPC Supabase).
 * @param {string} [userId] — giữ tham số cho tương lai; RPC hiện xóa toàn bộ theo tuổi.
 */
export async function cleanOldNotificationsInSupabase(userId) {
  void userId
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const client = getSupabaseClient()
  if (!client) return { ok: true, skipped: true }

  const { data, error } = await client.rpc('clean_old_notifications')
  if (error) {
    console.warn('[notifications] cleanOld', error)
    return { ok: false, error }
  }
  bump()
  return { ok: true, deleted: data }
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
  void touchedVariantIds
  return syncTodayLowStockDigest(catalog, userId)
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
