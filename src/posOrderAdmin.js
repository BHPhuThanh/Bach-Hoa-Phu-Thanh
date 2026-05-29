import { normalizeBarcodeValue } from './catalogCsv.js'
import {
  getComboBom,
  isComboCatalogProduct,
  findProductContainingVariantId,
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

export function posOrderLineReturnableQty(it) {
  const qty = Math.max(0, Number(it.qty) || 0)
  let returnedQty = Math.max(0, Number(it.returnedQty) || 0)
  if (returnedQty > qty) returnedQty = qty
  return Math.max(0, qty - returnedQty)
}

/** Dòng giỏ để hoàn tồn khi xóa đơn (số lượng = đã bán − đã trả). */
export function buildOrderDeleteRestoreCartLines(catalogList, items) {
  const list = Array.isArray(items) ? items : []
  const cartLines = []
  let needRestore = 0
  for (const it of list) {
    if (!it) continue
    const restoreQty = posOrderLineReturnableQty(it)
    if (restoreQty <= 0) continue
    needRestore++
    const variantId = String(resolvePosItemVariantId(catalogList, it) || '').trim()
    if (!variantId) continue
    cartLines.push({
      variantId,
      qty: restoreQty,
      code: it.code,
      unitLabel: it.unitLabel,
      barcode: it.barcode,
      selectedBatchId: it.selectedBatchId,
    })
  }
  return { cartLines, needRestore, resolvedCount: cartLines.length }
}

/**
 * Một dòng đơn trả → dòng giỏ hoàn tồn (combo: tách BOM, SL = SL combo trả × SL thành phần / combo).
 */
export function expandPosReturnLineToRestoreCartLines(catalogList, item, returnQty) {
  const qty = Math.max(0, Number(returnQty) || 0)
  if (qty <= 0 || !item) return []

  const vid = String(resolvePosItemVariantId(catalogList, item) || item.variantId || '').trim()
  if (!vid) return []

  const p = findProductContainingVariantId(catalogList, vid)
  const isCombo =
    (p && isComboCatalogProduct(p)) ||
    item.isCombo === true ||
    item.is_combo === true ||
    (Array.isArray(item.combo_items) && item.combo_items.length > 0) ||
    (Array.isArray(item.comboBom) && item.comboBom.length > 0)

  if (isCombo && p) {
    const bom = getComboBom(p)
    const lines = []
    for (const row of bom) {
      const per = Number(row.qty) || 0
      if (per <= 0) continue
      const compVid = String(row.variantId ?? '').trim()
      if (!compVid) continue
      lines.push({
        variantId: compVid,
        qty: qty * per,
        code: row.codeSnap || item.code,
        unitLabel: row.unitLabelSnap || item.unitLabel,
        barcode: item.barcode,
        isComboReturnComponent: true,
      })
    }
    return lines
  }

  return [
    {
      variantId: vid,
      qty,
      code: item.code,
      unitLabel: item.unitLabel,
      barcode: item.barcode,
      isComboReturnComponent: false,
    },
  ]
}

/** Gom các dòng đơn đang trả thành cartLines cho {@link applyRestoredQtyToCatalog}. */
export function buildPosReturnRestoreCartLines(catalogList, items, qtyForLine) {
  const list = Array.isArray(items) ? items : []
  const cartLines = []
  for (const it of list) {
    if (!it) continue
    const returnQty = typeof qtyForLine === 'function' ? qtyForLine(it) : 0
    if (returnQty <= 0) continue
    cartLines.push(...expandPosReturnLineToRestoreCartLines(catalogList, it, returnQty))
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
    const lineCost =
      raw.lineCost != null && Number.isFinite(Number(raw.lineCost))
        ? Number(raw.lineCost)
        : cost * qty
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
