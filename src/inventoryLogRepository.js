/**
 * Supabase nhật ký tồn kho (`inventory_log`) — đơn vị cơ bản (khớp ton_kho DB).
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import { readStoredSellerId } from './sellerRoleStorage.js'
import { flattenDisplayCatalogToVariants } from './catalogRepository.js'
import {
  collectSiblingVariantIds,
  findCatalogVariantInProducts,
  findProductContainingVariantId,
  isComboCatalogProduct,
  mergeComboCartLineIntoDeltaMap,
  resolveMaGocFromVariant,
  variantQuyDoiNumber,
} from './comboCatalog.js'

export const INVENTORY_LOG_TABLE = 'inventory_log'

/** Tên nhân viên đang thao tác POS/Hub (không có auth SSO — mặc định chủ cửa hàng). */
export function staffNameForInventoryLog() {
  const id = readStoredSellerId()
  if (id === 'staff') return 'Nhân viên'
  if (id === 'admin') return 'Chủ cửa hàng'
  return 'Chủ cửa hàng'
}

function escapeIlikePct(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function localMidnightUtcIso(y, mZeroBased, day) {
  return new Date(y, mZeroBased, day, 0, 0, 0, 0).toISOString()
}

function localEndOfDayUtcIso(y, mZeroBased, day) {
  return new Date(y, mZeroBased, day, 23, 59, 59, 999).toISOString()
}

function parseYyyyMmDdToLocalIsoRangeEnds(ymd) {
  const s = String(ymd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [yy, mm, dd] = s.split('-').map((x) => parseInt(x, 10))
  if (
    !Number.isFinite(yy) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(dd) ||
    mm < 1 ||
    mm > 12
  )
    return null
  try {
    return {
      startIso: localMidnightUtcIso(yy, mm - 1, dd),
      endIso: localEndOfDayUtcIso(yy, mm - 1, dd),
    }
  } catch {
    return null
  }
}

function stockTonAfterMaGoc(catalogProducts, maGoc) {
  const k = String(maGoc ?? '').trim()
  if (!k) return null
  for (const sid of collectSiblingVariantIds(catalogProducts, k)) {
    const hit = findCatalogVariantInProducts(catalogProducts, sid)
    const raw = hit?.variant?.stockQty
    if (raw != null && Number.isFinite(Number(raw))) return Number(raw)
  }
  return null
}

/**
 * Sau bán POS: một dòng cho mã hàng trong giỏ (thành phần combo được tách theo BOM).
 */
export function buildPosSaleInventoryLogRows(prevProducts, nextProducts, order, cartLines) {
  if (!prevProducts?.length || !nextProducts?.length || !order) return []
  const orderId = String(order.id ?? '').trim()
  const doc = String(order.invoiceNo ?? '').trim() || orderId || '—'
  const staffName = staffNameForInventoryLog()
  const rows = []

  for (const line of cartLines || []) {
    const p = findProductContainingVariantId(prevProducts, line.variantId)
    if (p && isComboCatalogProduct(p)) {
      const deltaBaseByVid = new Map()
      mergeComboCartLineIntoDeltaMap(prevProducts, line, deltaBaseByVid)
      for (const [compVid, basePieces] of deltaBaseByVid) {
        const q = Number(basePieces)
        if (!Number.isFinite(q) || q <= 0) continue
        const hit = findCatalogVariantInProducts(prevProducts, compVid)
        if (!hit?.variant) continue
        const ma = String(hit.variant.code ?? '').trim()
        const maGoc = resolveMaGocFromVariant(hit.variant)
        if (!ma || !maGoc) continue
        const stockAfter = stockTonAfterMaGoc(nextProducts, maGoc)
        if (stockAfter == null) continue
        rows.push({
          ma_hang: ma,
          transaction_type: 'Bán hàng',
          document_code: doc,
          change_qty: -q,
          stock_after: stockAfter,
          staff_name: staffName,
          pos_order_id: orderId || null,
          inbound_order_id: null,
        })
      }
      continue
    }

    const hit = findCatalogVariantInProducts(prevProducts, line.variantId)
    if (!hit?.variant) continue
    const v = hit.variant
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const ma = String(v.code ?? '').trim()
    const maGoc = resolveMaGocFromVariant(v)
    if (!ma || !maGoc) continue
    const dq = qty * variantQuyDoiNumber(v)
    const stockAfter = stockTonAfterMaGoc(nextProducts, maGoc)
    if (stockAfter == null) continue
    rows.push({
      ma_hang: ma,
      transaction_type: 'Bán hàng',
      document_code: doc,
      change_qty: -dq,
      stock_after: stockAfter,
      staff_name: staffName,
      pos_order_id: orderId || null,
      inbound_order_id: null,
    })
  }

  return rows
}

/** Nhập hàng sau khi biết patches + catalog trước/sau. */
export function buildInboundInventoryLogRows(prevProducts, nextProducts, patches, meta) {
  const doc = String(meta?.documentCode ?? '').trim()
  const inboundOid = String(meta?.inboundOrderId ?? '').trim()
  const staffName = meta?.staffName ?? staffNameForInventoryLog()
  if (!doc || !patches?.length) return []

  const flatPrev = flattenDisplayCatalogToVariants(prevProducts || [])
  const flatNext = flattenDisplayCatalogToVariants(nextProducts || [])
  const rows = []

  for (const entry of patches) {
    const id = String(entry?.variantId ?? '')
    if (!id) continue
    const v0 = flatPrev.find((v) => String(v?.id) === id)
    const v1 = flatNext.find((v) => String(v?.id) === id)
    if (!v1) continue
    const b0 =
      v0?.stockQty != null && Number.isFinite(Number(v0.stockQty)) ? Number(v0.stockQty) : null
    const b1 =
      v1.stockQty != null && Number.isFinite(Number(v1.stockQty)) ? Number(v1.stockQty) : null
    if (b0 == null && b1 == null) continue
    const n0 = b0 != null ? b0 : b1 ?? 0
    const n1 = b1 != null ? b1 : 0
    if (Math.abs(n1 - n0) < 1e-9) continue
    const ma = String(v1.code ?? '').trim()
    if (!ma) continue
    rows.push({
      ma_hang: ma,
      transaction_type: 'Nhập hàng',
      document_code: doc,
      change_qty: n1 - n0,
      stock_after: n1,
      staff_name: staffName,
      pos_order_id: null,
      inbound_order_id: inboundOid || null,
    })
  }

  return rows
}

/** Chỉnh / kiểm kho — chênh tồn DB theo nhóm đã chỉnh. */
export function buildStockAdjustInventoryLogRows(
  prevProducts,
  nextProducts,
  variantIds,
  opts = {}
) {
  const staffName = opts.staffName ?? staffNameForInventoryLog()
  const docCode =
    opts.documentCode !== undefined ? String(opts.documentCode) : 'Sửa thủ công'
  const transactionType =
    opts.transactionType !== undefined ? String(opts.transactionType) : 'Điều chỉnh'

  const flatPrev = flattenDisplayCatalogToVariants(prevProducts || [])
  const flatNext = flattenDisplayCatalogToVariants(nextProducts || [])
  const rows = []

  const idSet =
    variantIds instanceof Set ? variantIds : new Set(Array.isArray(variantIds) ? variantIds : [])

  for (const vid of idSet) {
    const id = String(vid)
    const v0 = flatPrev.find((v) => String(v?.id) === id)
    const v1 = flatNext.find((v) => String(v?.id) === id)
    if (!v1) continue
    const n0 =
      v0?.stockQty != null && Number.isFinite(Number(v0.stockQty)) ? Number(v0.stockQty) : null
    const n1 =
      v1.stockQty != null && Number.isFinite(Number(v1.stockQty)) ? Number(v1.stockQty) : null
    if (n0 == null && n1 == null) continue
    const a = n0 != null ? n0 : n1 ?? 0
    const b = n1 != null ? n1 : a
    if (Math.abs(b - a) < 1e-9) continue
    const ma = String(v1.code ?? '').trim()
    if (!ma) continue
    rows.push({
      ma_hang: ma,
      transaction_type: transactionType,
      document_code: docCode,
      change_qty: b - a,
      stock_after: b,
      staff_name: staffName,
      pos_order_id: null,
      inbound_order_id: null,
    })
  }

  return rows
}

export async function insertInventoryLogRows(rows) {
  if (!isSupabaseConfigured() || !rows?.length) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, skipped: true }
  try {
    const { error } = await sb.from(INVENTORY_LOG_TABLE).insert(rows)
    if (error) {
      console.warn('[inventory_log] insert:', error.message || error)
      return { ok: false, error }
    }
    return { ok: true }
  } catch (e) {
    console.warn('[inventory_log]', e)
    return { ok: false, error: e }
  }
}

function formatQtyViSigned(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x === 0) return '0'
  const body = Math.abs(x).toLocaleString('vi-VN', { maximumFractionDigits: 6 })
  return x > 0 ? `+${body}` : `-${body}`
}

function formatStockAfterVi(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  if (Math.abs(x - Math.round(x)) < 1e-9) return Math.round(x).toLocaleString('vi-VN')
  return x.toLocaleString('vi-VN', { maximumFractionDigits: 6 })
}

const INVENTORY_DT = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

export function inventoryCreatedAtLabel(iso) {
  try {
    const d = iso ? new Date(iso) : null
    if (!d || Number.isNaN(d.getTime())) return '—'
    return INVENTORY_DT.format(d)
  } catch {
    return '—'
  }
}

function isInboundDocumentCode(docNoRaw) {
  const d = String(docNoRaw ?? '').trim()
  return /^(PN|NH)/i.test(d)
}

/** Dòng UI «Lịch sử kho» (inventory_log đã fetch). */
export function mapInventoryLogDbRowToDisplay(row) {
  const delta = Number(row.change_qty)
  const balance = Number(row.stock_after)
  const docNo = String(row.document_code ?? '—')
  const staffName = String(row.staff_name ?? '').trim() || '—'
  return {
    key: String(row.id),
    /** Hiển thị cột Ngày ↔ created_at */
    dateLabel: inventoryCreatedAtLabel(row.created_at),
    /** Hiển thị cột Nhân viên ↔ staff_name */
    staffNameLabel: staffName,
    /** Hiển thị cột Thao tác ↔ transaction_type */
    transactionTypeLabel: String(row.transaction_type ?? '—'),
    /** Hiển thị cột Số lượng ↔ change_qty */
    qtyLabel: formatQtyViSigned(delta),
    /** Hiển thị cột Tồn kho ↔ stock_after */
    stockAfterLabel: formatStockAfterVi(balance),
    /** Hiển thị / liên kết cột Mã chứng từ ↔ document_code */
    docNo,
    qtyRaw: delta,
    stockRaw: balance,

    inventoryNavSource: 'supabase',
    pos_order_id: row.pos_order_id ? String(row.pos_order_id) : '',
    inbound_order_id: row.inbound_order_id ? String(row.inbound_order_id) : '',
    inventoryDocClickable:
      /^HD/i.test(docNo) ||
      isInboundDocumentCode(docNo) ||
      Boolean(row.pos_order_id) ||
      Boolean(row.inbound_order_id),

    /* Tương thích mã JSX cũ */
    delta,
    deltaLabel: formatQtyViSigned(delta),
    balanceLabel: formatStockAfterVi(balance),
    staff: staffName,
    action: String(row.transaction_type ?? '—'),
    docLink: null,
  }
}

const INVENTORY_LOG_SELECT_COLUMNS =
  'id, created_at, ma_hang, transaction_type, document_code, change_qty, stock_after, staff_name, pos_order_id, inbound_order_id'

/**
 * @param {string} maHangRaw
 * @param {number | object} limitOrOpts — số hoặc { limit?, dateFrom?, dateTo?, documentSearch? }
 */
export async function fetchInventoryLogsByMaHang(maHangRaw, limitOrOpts = 200) {
  const ma = String(maHangRaw ?? '').trim()
  if (!isSupabaseConfigured() || !ma) return { ok: false, rows: [], skipped: true }

  let limit = 200
  let dateFromStr = ''
  let dateToStr = ''
  let documentSearch = ''
  if (typeof limitOrOpts === 'number') {
    limit = limitOrOpts
  } else if (limitOrOpts && typeof limitOrOpts === 'object') {
    limit = Number(limitOrOpts.limit) || 200
    dateFromStr = String(limitOrOpts.dateFrom ?? '').trim()
    dateToStr = String(limitOrOpts.dateTo ?? '').trim()
    documentSearch = String(limitOrOpts.documentSearch ?? '').trim()
  }
  limit = Math.min(Math.max(limit, 1), 800)

  const sb = getSupabaseClient()
  if (!sb) return { ok: false, rows: [], skipped: true }

  try {
    let q = sb
      .from(INVENTORY_LOG_TABLE)
      .select(INVENTORY_LOG_SELECT_COLUMNS)
      .eq('ma_hang', ma)

    const rngFrom = dateFromStr ? parseYyyyMmDdToLocalIsoRangeEnds(dateFromStr) : null
    const rngTo = dateToStr ? parseYyyyMmDdToLocalIsoRangeEnds(dateToStr) : null
    if (rngFrom?.startIso) q = q.gte('created_at', rngFrom.startIso)
    if (rngTo?.endIso) q = q.lte('created_at', rngTo.endIso)

    if (documentSearch) {
      const pat = `%${escapeIlikePct(documentSearch)}%`
      q = q.ilike('document_code', pat)
    }

    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)

    if (error) {
      console.warn('[inventory_log] fetch:', error.message || error)
      return { ok: false, rows: [], error }
    }
    return { ok: true, rows: Array.isArray(data) ? data : [] }
  } catch (e) {
    console.warn('[inventory_log] fetch:', e)
    return { ok: false, rows: [], error: e }
  }
}
