/**
 * Supabase nhật ký tồn kho (`inventory_log`) — đơn vị cơ bản (khớp ton_kho DB).
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import { withSupabaseRetry } from './supabaseRetry.js'
import { readStoredSellerId } from './sellerRoleStorage.js'
import { flattenDisplayCatalogToVariants } from './catalogRepository.js'
import {
  collectSiblingVariantIds,
  findCanonicalStockRootVariant,
  findCatalogVariantInProducts,
  findProductContainingVariantId,
  isComboCatalogProduct,
  mergeComboCartLineIntoDeltaMap,
  resolveMaGocFromVariant,
  variantQuyDoiNumber,
} from './comboCatalog.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'

export const INVENTORY_LOG_TABLE = 'inventory_log'
export const INVENTORY_LOG_UPDATED_EVENT = 'inventory-log-updated'

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
  return new Date(y, mZeroBased, day, 23, 59, 59, 0).toISOString()
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

/** Mọi `ma_hang` thuộc nhóm catalog (ĐVT anh em) — dùng khi fetch dòng cũ chưa có product_id. */
export function collectMaHangCodesForCatalogProduct(products, productId) {
  const pid = String(productId ?? '').trim()
  if (!pid) return []
  const p = (products || []).find((x) => String(x?.id) === pid)
  if (!p) return []
  const codes = new Set()
  for (const v of p.groupVariants || [p]) {
    const c = String(v.code ?? '').trim()
    if (c) codes.add(c)
  }
  return [...codes]
}

function inventoryLogCatalogMeta(products, variant) {
  if (!variant) return {}
  const p = findProductContainingVariantId(products, variant.id)
  const productId = String(p?.id ?? '').trim()
  const maGoc = resolveMaGocFromVariant(variant)
  const root = maGoc
    ? findCanonicalStockRootVariant(products, collectSiblingVariantIds(products, maGoc))
    : null
  return {
    product_id: productId || null,
    variant_id: String(variant.id ?? '').trim() || null,
    txn_unit_label: normalizeCatalogUnitLabel(variant.unitLabel),
    base_unit_label: normalizeCatalogUnitLabel(root?.unitLabel ?? variant.unitLabel),
  }
}

function withInventoryLogCatalogMeta(row, products, variant, txnQty) {
  const meta = inventoryLogCatalogMeta(products, variant)
  const q = Number(txnQty)
  return {
    ...row,
    ...meta,
    txn_qty: Number.isFinite(q) ? q : null,
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
        rows.push(
          withInventoryLogCatalogMeta(
            {
              ma_hang: ma,
              ten_hang: String(hit.product?.name ?? hit.variant?.name ?? '').trim() || '—',
              transaction_type: 'Bán hàng',
              document_code: doc,
              change_qty: -q,
              stock_after: stockAfter,
              staff_name: staffName,
            },
            prevProducts,
            hit.variant,
            q
          )
        )
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
    rows.push(
      withInventoryLogCatalogMeta(
        {
          ma_hang: ma,
          ten_hang: String(hit.product?.name ?? v.name ?? '').trim() || '—',
          transaction_type: 'Bán hàng',
          document_code: doc,
          change_qty: -dq,
          stock_after: stockAfter,
          staff_name: staffName,
        },
        prevProducts,
        v,
        qty
      )
    )
  }

  return rows
}

/**
 * Sau trả hàng / xóa đơn — cộng tồn thành phần lẻ. Không ghi cho mã combo tổng (giống luồng bán).
 */
export function buildPosReturnInventoryLogRows(prevProducts, nextProducts, meta, cartLines) {
  if (!prevProducts?.length || !nextProducts?.length) return []
  const doc = String(meta?.documentCode ?? '').trim()
  if (!doc) return []
  const staffName = meta?.staffName ?? staffNameForInventoryLog()
  const txnCombo = `Khách trả hàng Combo (${doc})`
  const txnRegular = 'Khách trả hàng'
  const rows = []

  const pushRestoreRow = (hit, v, changeQty, txnType, txnQty) => {
    const ma = String(v.code ?? '').trim()
    const maGoc = resolveMaGocFromVariant(v)
    if (!ma || !maGoc) return
    const cq = Number(changeQty)
    if (!Number.isFinite(cq) || cq <= 0) return
    const stockAfter = stockTonAfterMaGoc(nextProducts, maGoc)
    if (stockAfter == null) return
    rows.push(
      withInventoryLogCatalogMeta(
        {
          ma_hang: ma,
          ten_hang: String(hit.product?.name ?? v.name ?? '').trim() || '—',
          transaction_type: txnType,
          document_code: doc,
          change_qty: cq,
          stock_after: stockAfter,
          staff_name: staffName,
        },
        nextProducts,
        v,
        txnQty
      )
    )
  }

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
        pushRestoreRow(hit, hit.variant, q, txnCombo, q)
      }
      continue
    }

    const hit = findCatalogVariantInProducts(prevProducts, line.variantId)
    if (!hit?.variant) continue
    const v = hit.variant
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const dq = qty * variantQuyDoiNumber(v)
    const txnType = line.isComboReturnComponent ? txnCombo : txnRegular
    pushRestoreRow(hit, v, dq, txnType, qty)
  }

  return rows
}

/** Nhập hàng sau khi biết patches + catalog trước/sau. */
export function buildInboundInventoryLogRows(prevProducts, nextProducts, patches, meta) {
  const doc = String(meta?.documentCode ?? '').trim()
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
    const delta = n1 - n0
    rows.push(
      withInventoryLogCatalogMeta(
        {
          ma_hang: ma,
          ten_hang: String(v1.name ?? '').trim() || '—',
          transaction_type: 'Nhập hàng',
          document_code: doc,
          change_qty: delta,
          stock_after: n1,
          staff_name: staffName,
        },
        nextProducts,
        v1,
        Math.abs(delta)
      )
    )
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
    const delta = b - a
    rows.push(
      withInventoryLogCatalogMeta(
        {
          ma_hang: ma,
          ten_hang: String(v1.name ?? '').trim() || '—',
          transaction_type: transactionType,
          document_code: docCode,
          change_qty: delta,
          stock_after: b,
          staff_name: staffName,
        },
        nextProducts,
        v1,
        Math.abs(delta)
      )
    )
  }

  return rows
}

export async function insertInventoryLogRows(rows) {
  if (!isSupabaseConfigured() || !rows?.length) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, skipped: true }
  const cleanedRows = rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      return {
        staff_name: row.staff_name === undefined ? null : row.staff_name,
        transaction_type: row.transaction_type === undefined ? null : row.transaction_type,
        change_qty: row.change_qty === undefined ? null : row.change_qty,
        stock_after: row.stock_after === undefined ? null : row.stock_after,
        document_code: row.document_code === undefined ? null : row.document_code,
        ma_hang: row.ma_hang === undefined ? null : row.ma_hang,
        ten_hang: row.ten_hang === undefined ? null : row.ten_hang,
        product_id: row.product_id === undefined ? null : row.product_id,
        variant_id: row.variant_id === undefined ? null : row.variant_id,
        txn_qty: row.txn_qty === undefined ? null : row.txn_qty,
        txn_unit_label: row.txn_unit_label === undefined ? null : row.txn_unit_label,
        base_unit_label: row.base_unit_label === undefined ? null : row.base_unit_label,
      }
    })
  if (!cleanedRows.length) return { ok: true, skipped: true }
  try {
    // Retry khi timeout/mạng chập chờn — chấp nhận rủi ro nhỏ trùng dòng lịch sử (hiếm, chỉ
    // ảnh hưởng hiển thị) để đổi lấy việc không bao giờ mất hẳn dòng lịch sử kho.
    await withSupabaseRetry(async () => {
      const res = await sb.from(INVENTORY_LOG_TABLE).insert(cleanedRows)
      if (res.error) throw res.error
      return res
    })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(INVENTORY_LOG_UPDATED_EVENT))
    }
    return { ok: true }
  } catch (e) {
    const error = e && typeof e === 'object' ? e : null
    console.error(
      'Lỗi lưu lịch sử kho:',
      error?.message ?? String(e ?? ''),
      error?.details,
      error?.hint
    )
    return { ok: false, error: e }
  }
}

function formatQtyViSigned(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x === 0) return '0'
  const body = Math.abs(x).toLocaleString('vi-VN', { maximumFractionDigits: 6 })
  return x > 0 ? `+${body}` : `-${body}`
}

function formatQtyViAbs(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x === 0) return '0'
  return Math.abs(x).toLocaleString('vi-VN', { maximumFractionDigits: 6 })
}

function findVariantInCatalogProductByMaHang(products, productId, maHang) {
  const pid = String(productId ?? '').trim()
  const ma = String(maHang ?? '').trim()
  if (!pid || !ma) return null
  const p = (products || []).find((x) => String(x?.id) === pid)
  if (!p) return null
  for (const v of p.groupVariants || [p]) {
    if (String(v.code ?? '').trim() === ma) return v
  }
  return null
}

function resolveInventoryLogUnitLabels(row, catalogProducts) {
  let txnUnit = String(row.txn_unit_label ?? '').trim()
  let baseUnit = String(row.base_unit_label ?? '').trim()
  const pid = String(row.product_id ?? '').trim()
  const vid = String(row.variant_id ?? '').trim()
  const ma = String(row.ma_hang ?? '').trim()

  if (catalogProducts?.length) {
    if (!txnUnit && vid) {
      const hit = findCatalogVariantInProducts(catalogProducts, vid)
      if (hit?.variant) txnUnit = normalizeCatalogUnitLabel(hit.variant.unitLabel)
    }
    if (!txnUnit && pid && ma) {
      const v = findVariantInCatalogProductByMaHang(catalogProducts, pid, ma)
      if (v) txnUnit = normalizeCatalogUnitLabel(v.unitLabel)
    }
    if (!baseUnit && (vid || (pid && ma))) {
      const v =
        (vid && findCatalogVariantInProducts(catalogProducts, vid)?.variant) ||
        (pid && ma ? findVariantInCatalogProductByMaHang(catalogProducts, pid, ma) : null)
      if (v) {
        const maGoc = resolveMaGocFromVariant(v)
        const root = maGoc
          ? findCanonicalStockRootVariant(
              catalogProducts,
              collectSiblingVariantIds(catalogProducts, maGoc)
            )
          : null
        baseUnit = normalizeCatalogUnitLabel(root?.unitLabel ?? v.unitLabel)
      }
    }
  }
  return { txnUnit, baseUnit }
}

/** Nhãn ĐVT giao dịch + quy đổi cơ bản (vd. «1 Lốc» + «Quy đổi: -6 Chai»). */
export function formatInventoryLogUnitConversionLabels(row, catalogProducts) {
  const txnQtyRaw = row.txn_qty
  const txnQty =
    txnQtyRaw != null && txnQtyRaw !== '' && Number.isFinite(Number(txnQtyRaw))
      ? Number(txnQtyRaw)
      : null
  const baseDelta = Number(row.change_qty)
  const { txnUnit, baseUnit } = resolveInventoryLogUnitLabels(row, catalogProducts)

  const txnPart =
    txnQty != null && txnQty > 0 && txnUnit ? `${formatQtyViAbs(txnQty)} ${txnUnit}` : ''

  const convPart =
    baseUnit && Number.isFinite(baseDelta) && baseDelta !== 0
      ? `Quy đổi: ${formatQtyViSigned(baseDelta)} ${baseUnit}`
      : Number.isFinite(baseDelta) && baseDelta !== 0
        ? formatQtyViSigned(baseDelta)
        : ''
  const unitTxnLabel = txnPart || (txnUnit ? txnUnit : '—')
  const conversionLabel = convPart || '—'
  const detailLabel =
    txnPart && convPart ? `${txnPart} (${convPart})` : txnPart || convPart || '—'

  return { unitTxnLabel, conversionLabel, detailLabel }
}

function formatStockAfterVi(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  if (Math.abs(x - Math.round(x)) < 1e-9) return Math.round(x).toLocaleString('vi-VN')
  return x.toLocaleString('vi-VN', { maximumFractionDigits: 6 })
}

export function inventoryCreatedAtLabel(iso) {
  try {
    const d = iso ? new Date(iso) : null
    if (!d || Number.isNaN(d.getTime())) return '—'
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = String(d.getFullYear())
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`
  } catch {
    return '—'
  }
}

function isInboundDocumentCode(docNoRaw) {
  const d = String(docNoRaw ?? '').trim()
  return /^(PN|NH)/i.test(d)
}

/** Dòng UI «Lịch sử kho» (inventory_log đã fetch). */
export function mapInventoryLogDbRowToDisplay(row, opts = {}) {
  const delta = Number(row.change_qty)
  const balance = Number(row.stock_after)
  const docNo = String(row.document_code ?? '—')
  const staffName = String(row.staff_name ?? '').trim() || '—'
  const posOrderId = String(row.pos_order_id ?? '').trim() || null
  const inboundOrderId = String(row.inbound_order_id ?? '').trim() || null
  let docLink = null
  if (posOrderId) docLink = { type: 'pos', posOrderId, docNo }
  else if (inboundOrderId) docLink = { type: 'inbound', inboundOrderId, docNo }
  const { unitTxnLabel, conversionLabel, detailLabel } = formatInventoryLogUnitConversionLabels(
    row,
    opts.catalogProducts
  )
  return {
    key: String(row.id),
    /** Hiển thị cột Ngày ↔ created_at */
    dateLabel: inventoryCreatedAtLabel(row.created_at),
    /** Hiển thị cột Nhân viên ↔ staff_name */
    staffNameLabel: staffName,
    /** Hiển thị cột Thao tác ↔ transaction_type */
    transactionTypeLabel: String(row.transaction_type ?? '—'),
    /** ĐVT giao dịch (vd. 1 Lốc) */
    unitTxnLabel,
    /** Quy đổi cơ bản (vd. Quy đổi: -6 Chai) */
    conversionLabel,
    /** Gộp cho tooltip / xem trước */
    unitConversionDetailLabel: detailLabel,
    /** Hiển thị cột Số lượng ↔ change_qty (đơn vị cơ bản) */
    qtyLabel: formatQtyViSigned(delta),
    /** Hiển thị cột Tồn kho ↔ stock_after */
    stockAfterLabel: formatStockAfterVi(balance),
    /** Hiển thị / liên kết cột Mã chứng từ ↔ document_code */
    docNo,
    qtyRaw: delta,
    stockRaw: balance,

    inventoryNavSource: 'supabase',
    inventoryDocClickable: /^HD/i.test(docNo) || isInboundDocumentCode(docNo),

    posOrderId,
    inboundOrderId,

    /* Tương thích mã JSX cũ */
    delta,
    deltaLabel: formatQtyViSigned(delta),
    balanceLabel: formatStockAfterVi(balance),
    staff: staffName,
    action: String(row.transaction_type ?? '—'),
    docLink,
  }
}

function parseInventoryLogFetchOpts(limitOrOpts) {
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
  return {
    limit: Math.min(Math.max(limit, 1), 800),
    dateFromStr,
    dateToStr,
    documentSearch,
  }
}

function applyInventoryLogFetchFilters(q, { dateFromStr, dateToStr, documentSearch }) {
  const rngFrom = dateFromStr ? parseYyyyMmDdToLocalIsoRangeEnds(dateFromStr) : null
  const rngTo = dateToStr ? parseYyyyMmDdToLocalIsoRangeEnds(dateToStr) : null
  if (rngFrom?.startIso) q = q.gte('created_at', rngFrom.startIso)
  if (rngTo?.endIso) q = q.lte('created_at', rngTo.endIso)
  if (documentSearch) {
    const pat = `%${escapeIlikePct(documentSearch)}%`
    q = q.ilike('document_code', pat)
  }
  return q
}

/**
 * Lấy nhật ký theo nhóm sản phẩm (mọi ĐVT). Gồm dòng cũ (chỉ ma_hang) qua OR.
 * @param {string} productId — `catalog product.id`
 * @param {Array} catalogProducts — danh mục hiện tại (gom ma_hang anh em)
 * @param {number | object} limitOrOpts
 */
export async function fetchInventoryLogsByProductId(
  productId,
  catalogProducts,
  limitOrOpts = 200
) {
  const pid = String(productId ?? '').trim()
  if (!isSupabaseConfigured() || !pid) return { ok: false, rows: [], skipped: true }

  const { limit, dateFromStr, dateToStr, documentSearch } = parseInventoryLogFetchOpts(limitOrOpts)
  const maCodes = collectMaHangCodesForCatalogProduct(catalogProducts, pid)

  const sb = getSupabaseClient()
  if (!sb) return { ok: false, rows: [], skipped: true }

  try {
    const orParts = [`product_id.eq.${pid}`]
    if (maCodes.length > 0) {
      const inList = maCodes.map((c) => `"${String(c).replace(/"/g, '\\"')}"`).join(',')
      orParts.push(`ma_hang.in.(${inList})`)
    }
    let q = sb.from(INVENTORY_LOG_TABLE).select('*').or(orParts.join(','))
    q = applyInventoryLogFetchFilters(q, { dateFromStr, dateToStr, documentSearch })
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)

    if (error) {
      console.warn('[inventory_log] fetch by product:', error.message || error)
      return { ok: false, rows: [], error }
    }
    const rows = Array.isArray(data) ? data : []
    const seen = new Set()
    const deduped = []
    for (const row of rows) {
      const k = String(row.id ?? '')
      if (k && seen.has(k)) continue
      if (k) seen.add(k)
      deduped.push(row)
    }
    return { ok: true, rows: deduped }
  } catch (e) {
    console.warn('[inventory_log] fetch by product:', e)
    return { ok: false, rows: [], error: e }
  }
}

/**
 * @deprecated Dùng `fetchInventoryLogsByProductId` — giữ cho tương thích.
 * @param {string} maHangRaw
 * @param {number | object} limitOrOpts
 */
export async function fetchInventoryLogsByMaHang(maHangRaw, limitOrOpts = 200) {
  const ma = String(maHangRaw ?? '').trim()
  if (!isSupabaseConfigured() || !ma) return { ok: false, rows: [], skipped: true }

  const { limit, dateFromStr, dateToStr, documentSearch } = parseInventoryLogFetchOpts(limitOrOpts)
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, rows: [], skipped: true }

  try {
    let q = sb.from(INVENTORY_LOG_TABLE).select('*').eq('ma_hang', ma)
    q = applyInventoryLogFetchFilters(q, { dateFromStr, dateToStr, documentSearch })
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
