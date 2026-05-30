import { normalizeBarcodeValue } from './catalogCsv.js'
import {
  fetchComboBomFromSupabaseByMaHang,
  fetchComboUnitCostFromSupabaseByMaHang,
} from './catalogRepository.js'
import {
  isComboCatalogProduct,
  findComboProductByMaHang,
  findProductContainingVariantId,
  findVariantIdByMaHangInCatalog,
  getComboBom,
  orderLineIsCombo,
  enrichComboBomWithVariantIds,
  resolveComboBomForOrderLine,
} from './comboCatalog.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'

export function resolvePosItemVariantId(catalogList, item) {
  if (item?.variantId != null && String(item.variantId).trim()) return String(item.variantId).trim()
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  const code = String(item?.code || '').trim()
  const u = normalizeCatalogUnitLabel(item?.unitLabel || '')
  const cand = flat.filter(
    (v) =>
      String(v.code || '').trim() === code && normalizeCatalogUnitLabel(v.unitLabel || '') === u
  )
  if (cand.length === 1) return String(cand[0].id)

  const bc = normalizeBarcodeValue(item?.barcode ?? '')
  if (bc) {
    const byBc = flat.filter((v) => normalizeBarcodeValue(v.barcode ?? '') === bc)
    if (byBc.length === 1) return String(byBc[0].id)
  }

  if (code) {
    const byCode = flat.filter((v) => String(v.code || '').trim() === code)
    if (byCode.length === 1) return String(byCode[0].id)
  }

  return ''
}

/**
 * Giá vốn đơn vị theo đơn gốc lúc bán (cost / lineCost / lineProfit) — không tính lại từ catalog.
 * @returns {number | null} null nếu đơn không lưu đủ dữ liệu vốn.
 */
export function posOrderLineUnitCostFromStoredOrder(item) {
  if (!item) return null
  const qty = Math.max(0, Number(item.qty) || 0)
  const price = Math.max(0, Number(item.price) || 0)

  const unitCostField = Number(item.cost)
  if (Number.isFinite(unitCostField) && unitCostField > 0) {
    return Math.round(unitCostField)
  }

  if (qty > 0) {
    const lineCost = Number(item.lineCost)
    if (Number.isFinite(lineCost) && lineCost > 0) {
      return Math.round(lineCost / qty)
    }
    const lineProfit = Number(item.lineProfit)
    const lineRevenue = Number(item.lineRevenue)
    if (Number.isFinite(lineProfit)) {
      const rev =
        Number.isFinite(lineRevenue) && lineRevenue > 0 ? lineRevenue : Math.round(price * qty)
      const totalCost = rev - lineProfit
      if (totalCost > 0) return Math.round(totalCost / qty)
    }
  }
  return null
}

/**
 * Lợi nhuận hoàn lại (số dương = mức LN bị trừ khỏi báo cáo): SL trả × (giá bán − giá vốn đơn gốc).
 */
export function posOrderReturnProfitReversal(item, returnQty, unitCost) {
  const q = Math.max(0, Number(returnQty) || 0)
  const price = Math.max(0, Number(item?.price) || 0)
  const uc = Math.max(0, Number(unitCost) || 0)
  return Math.round(q * (price - uc))
}

/**
 * Giá vốn đơn vị khi hoàn trả: ưu tiên đơn gốc; chỉ fallback DB/BOM khi đơn thiếu vốn.
 * @param {Array} catalogList
 * @param {object} item — dòng đơn (preferStoredLineFinancials)
 */
export async function resolvePosReturnLineUnitCost(catalogList, item) {
  const fromOrder = posOrderLineUnitCostFromStoredOrder(item)
  if (fromOrder != null && fromOrder > 0) return fromOrder

  const code = String(item?.code ?? '').trim()
  if (code && orderLineIsCombo(catalogList, item)) {
    const fromDb = await fetchComboUnitCostFromSupabaseByMaHang(code, catalogList)
    if (fromDb > 0) return fromDb
  }

  return fromOrder != null ? Math.max(0, fromOrder) : 0
}

/** @deprecated Dùng {@link resolvePosReturnLineUnitCost} */
export async function posOrderLineUnitCostForReturn(catalogList, item) {
  return resolvePosReturnLineUnitCost(catalogList, item)
}

export function posOrderLineReturnableQty(it) {
  const qty = Math.max(0, Number(it.qty) || 0)
  let returnedQty = Math.max(0, Number(it.returnedQty) || 0)
  if (returnedQty > qty) returnedQty = qty
  return Math.max(0, qty - returnedQty)
}

/** Dòng giỏ để hoàn tồn khi xóa đơn (combo → chỉ thành phần lẻ, không mã combo tổng). */
export async function buildOrderDeleteRestoreCartLines(catalogList, items) {
  const list = Array.isArray(items) ? items : []
  let needRestore = 0
  for (const it of list) {
    if (it && posOrderLineReturnableQty(it) > 0) needRestore++
  }
  const cartLines = await buildPosReturnRestoreCartLines(catalogList, list, posOrderLineReturnableQty)
  return { cartLines, needRestore, resolvedCount: cartLines.length }
}

/** BOM combo cho hoàn tồn: đơn → catalog → Supabase (không trả mảng rỗng khi DB/catalog còn BOM). */
async function resolveComboBomForPosReturnRestore(catalogList, item) {
  let bom = resolveComboBomForOrderLine(catalogList, item)
  if (bom.length) return bom
  const code = String(item?.code ?? '').trim()
  if (!code) return []
  bom = await fetchComboBomFromSupabaseByMaHang(code, catalogList)
  if (bom.length) return bom
  const p = findComboProductByMaHang(catalogList, code)
  return enrichComboBomWithVariantIds(catalogList, getComboBom(p))
}

function expandPosReturnLinesFromBom(catalogList, item, comboReturnQty, bom) {
  const qty = Math.max(0, Number(comboReturnQty) || 0)
  const lines = []
  for (const row of bom || []) {
    const per = Number(row.qty) || 0
    if (per <= 0) continue
    let compVid = String(row.variantId ?? '').trim()
    const codeSnap = String(row.codeSnap ?? row.ma_hang ?? row.code ?? '').trim()
    if (!compVid && codeSnap) {
      compVid = findVariantIdByMaHangInCatalog(catalogList, codeSnap)
    }
    if (!compVid && !codeSnap) continue
    const compProduct = compVid ? findProductContainingVariantId(catalogList, compVid) : null
    if (compProduct && isComboCatalogProduct(compProduct)) continue
    lines.push({
      variantId: compVid,
      qty: qty * per,
      code: codeSnap || item.code,
      unitLabel: row.unitLabelSnap || item.unitLabel,
      barcode: item.barcode,
      selectedBatchId: item.selectedBatchId,
      isComboReturnComponent: true,
    })
  }
  return lines
}

/**
 * Một dòng đơn trả → dòng giỏ hoàn tồn (combo: SL lẻ = SL combo trả × SL trong 1 combo).
 */
export async function expandPosReturnLineToRestoreCartLines(catalogList, item, returnQty) {
  const qty = Math.max(0, Number(returnQty) || 0)
  if (qty <= 0 || !item) return []

  if (orderLineIsCombo(catalogList, item)) {
    let bom = resolveComboBomForOrderLine(catalogList, item)
    if (!bom.length) {
      const code = String(item.code ?? '').trim()
      if (code) {
        bom = await fetchComboBomFromSupabaseByMaHang(code, catalogList)
      }
    }
    return expandPosReturnLinesFromBom(catalogList, item, qty, bom)
  }

  let variantId = String(resolvePosItemVariantId(catalogList, item) || item.variantId || '').trim()
  if (!variantId) {
    variantId = findVariantIdByMaHangInCatalog(catalogList, item.code)
  }
  if (!variantId) return []
  const p = findProductContainingVariantId(catalogList, variantId)
  if (p && isComboCatalogProduct(p)) return []

  return [
    {
      variantId,
      qty,
      code: item.code,
      unitLabel: item.unitLabel,
      barcode: item.barcode,
      selectedBatchId: item.selectedBatchId,
      isComboReturnComponent: false,
    },
  ]
}

/** Gom các dòng đơn đang trả thành cartLines cho {@link applyRestoredQtyToCatalog}. */
export async function buildPosReturnRestoreCartLines(catalogList, items, qtyForLine) {
  const list = Array.isArray(items) ? items : []
  const cartLines = []
  for (const it of list) {
    if (!it) continue
    const returnQty = typeof qtyForLine === 'function' ? qtyForLine(it) : 0
    if (returnQty <= 0) continue
    const expanded = await expandPosReturnLineToRestoreCartLines(catalogList, it, returnQty)
    cartLines.push(...expanded)
  }
  return cartLines
}

export function computePosOrderStatusFromItems(items) {
  const lines = items || []
  if (lines.length === 0) return 'completed'
  const anyQty = lines.some((it) => (Number(it.qty) || 0) > 0)
  if (!anyQty) return 'returned_full'
  const allReturned = lines.every((it) => {
    const q = Math.max(0, Number(it.qty) || 0)
    const r = Math.max(0, Math.min(q, Number(it.returnedQty) || 0))
    return q <= 0 || r >= q
  })
  const anyReturned = lines.some((it) => (Number(it.returnedQty) || 0) > 0)
  if (allReturned) return 'returned_full'
  if (anyReturned) return 'returned_partial'
  return 'completed'
}

/**
 * Chuẩn hóa đơn POS (trạng thái, dòng, tổng).
 * @param {object} o
 * @param {object[]} catalogList
 * @param {{ preferStoredLineFinancials?: boolean }} [opts] Khi true: giữ đơn giá / giá vốn theo dòng đơn (lịch sử), trừ đơn bán sỉ — đơn sỉ luôn lấy lại giá vốn (E) từ catalog để LN đúng (giá bán T − vốn E).
 */
export function normalizePosOrder(o, catalogList, opts = {}) {
  const preferStored = opts.preferStoredLineFinancials === true
  if (!o) return null
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  const oid = String(o.id || '')
  const items = (o.items || []).map((raw, idx) => {
    const qty = Math.max(0, Number(raw.qty) || 0)
    let returnedQty = Math.max(0, Number(raw.returnedQty) || 0)
    if (returnedQty > qty) returnedQty = qty
    const variantId = resolvePosItemVariantId(catalogList, raw) || String(raw.variantId || '').trim()
    let cost = Math.max(0, Number(raw.cost) || 0)
    if (variantId) {
      const v = flat.find((x) => x.id === variantId)
      if (v && Number.isFinite(Number(v.cost))) {
        const costE = Math.max(0, Math.round(Number(v.cost) || 0))
        if (!preferStored || o.sellWholesaleMode === true) {
          cost = costE
        }
      }
    }
    const price = Math.max(0, Number(raw.price) || 0)
    const rawQuyDoi = Number(raw.quyDoi ?? raw.conversion ?? 1)
    const quyDoi = Number.isFinite(rawQuyDoi) && rawQuyDoi > 0 ? rawQuyDoi : 1
    /** Giá POS / lúc thanh toán = `price × qty` (quy_doi chỉ cho tồn kho, không nhân lại doanh thu). */
    const lineRevenue =
      raw.lineRevenue != null && Number.isFinite(Number(raw.lineRevenue))
        ? Number(raw.lineRevenue)
        : price * qty
    let lineCost =
      raw.lineCost != null && Number.isFinite(Number(raw.lineCost))
        ? Number(raw.lineCost)
        : cost * qty
    if (preferStored && qty > 0 && cost <= 0 && lineCost > 0) {
      cost = Math.round(lineCost / qty)
    }
    const lineProfit =
      raw.lineProfit != null && Number.isFinite(Number(raw.lineProfit))
        ? Number(raw.lineProfit)
        : lineRevenue - lineCost
    const orderLineId =
      String(raw.orderLineId || raw.lineId || '').trim() || `leg-${oid}-${idx}`
    return {
      ...raw,
      orderLineId,
      variantId,
      name: String(raw.name || '').trim(),
      code: String(raw.code || '').trim(),
      unitLabel: normalizeCatalogUnitLabel(raw.unitLabel),
      price,
      cost,
      qty,
      quyDoi,
      returnedQty,
      lineRevenue,
      lineCost,
      lineProfit,
    }
  })
  const subtotalFromLines = items.reduce((s, it) => s + (Number(it.lineRevenue) || 0), 0)
  const subtotalStored = Number(o.subtotal)
  const discountStored = Number(o.discount)
  const totalStored = Number(o.total)
  const totalCostStored = Number(o.totalCost)
  const totalProfitStored = Number(o.totalProfit)
  const subtotal = Number.isFinite(subtotalStored) ? subtotalStored : subtotalFromLines
  const disc = Number.isFinite(discountStored)
    ? Math.min(subtotal, Math.max(0, discountStored))
    : Math.min(subtotalFromLines, Math.max(0, Number(o.discount) || 0))
  const total = Number.isFinite(totalStored)
    ? Math.max(0, totalStored)
    : Math.max(0, subtotal - disc)
  const totalCost = Number.isFinite(totalCostStored)
    ? Math.max(0, totalCostStored)
    : items.reduce((s, it) => s + (Number(it.lineCost) || 0), 0)
  const totalProfit = Number.isFinite(totalProfitStored)
    ? totalProfitStored
    : total - totalCost
  const st = o.status
  const status = ['completed', 'returned_partial', 'returned_full', 'cancelled'].includes(st)
    ? st
    : 'completed'
  return {
    ...o,
    status,
    items,
    subtotal,
    discount: disc,
    total,
    totalCost,
    totalProfit,
  }
}

/** Map variantId → delta số lượng bán ghi nhận (dương = tăng SL bán trong đơn → trừ thêm tồn). */
export function posOrderSaleQtyDeltaMap(oldItems, newItems) {
  const key = (it) => String(it.orderLineId || it.lineId || '')
  const oldBy = new Map((oldItems || []).map((it) => [key(it), it]))
  const newBy = new Map((newItems || []).map((it) => [key(it), it]))
  const map = new Map()
  for (const [k, nit] of newBy) {
    if (!k) continue
    const oit = oldBy.get(k)
    const vid = String(nit.variantId || '').trim()
    if (!vid) continue
    const oldQ = oit ? Math.max(0, Number(oit.qty) || 0) : 0
    const newQ = Math.max(0, Number(nit.qty) || 0)
    const d = newQ - oldQ
    if (d) map.set(vid, (map.get(vid) || 0) + d)
  }
  for (const [k, oit] of oldBy) {
    if (!k || newBy.has(k)) continue
    const vid = String(oit.variantId || '').trim()
    if (!vid) continue
    const oldQ = Math.max(0, Number(oit.qty) || 0)
    if (oldQ) map.set(vid, (map.get(vid) || 0) - oldQ)
  }
  return map
}

export function posOrderStatusLabel(status) {
  if (status === 'cancelled') return 'Hủy đơn'
  if (status === 'returned_partial') return 'Đã hoàn trả một phần'
  if (status === 'returned_full') return 'Đã hoàn trả'
  return 'Hoàn thành'
}

/** Còn số lượng có thể trả (không phụ thuộc khớp variantId — thiếu mã vẫn cho nhập hoàn tiền theo đơn). */
export function posOrderCanPartialReturn(norm) {
  if (!norm || norm.status === 'cancelled') return false
  if (!['completed', 'returned_partial', 'returned_full'].includes(norm.status)) return false
  return (norm.items || []).some((it) => posOrderLineReturnableQty(it) > 0)
}
