/**
 * Bình quân gia quyền khi nhập hàng + cập nhật giá bán theo tỷ lệ cũ (giá bán / giá vốn).
 * Dùng tồn/giá vốn từ Supabase khi có; hỗ trợ phiếu mới và chỉnh sửa (so với dòng cũ).
 */

import { parsePrice, parseStockQty } from './catalogCsv.js'

function createInboundLineId() {
  return `il-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function normalizeInboundLineForCost(x) {
  const qty = Math.max(0, Number(x.qty) || 0)
  let returnedQty = Math.max(0, Number(x.returnedQty) || 0)
  if (returnedQty > qty) returnedQty = qty
  return {
    lineId: String(x.lineId || createInboundLineId()),
    variantId: String(x.variantId || ''),
    code: String(x.code ?? '').trim(),
    name: String(x.name ?? '').trim(),
    unitLabel: String(x.unitLabel ?? '').trim(),
    qty,
    returnedQty,
    unitPrice: Math.max(0, Number(x.unitPrice) || 0),
    lineDiscount: Math.max(0, Number(x.lineDiscount) || 0),
  }
}

/** SL còn trong kho từ dòng phiếu (đã trừ phần đã hoàn trả). */
export function inboundLineReturnableQtyForCost(line) {
  const l = normalizeInboundLineForCost(line)
  return Math.max(0, l.qty - l.returnedQty)
}

/** Thành tiền nhập ròng của dòng = qty×đơn giá − CK dòng (sau khi trừ hoàn trả). */
export function inboundLineNetPurchaseTotal(line) {
  const l = normalizeInboundLineForCost(line)
  const q = inboundLineReturnableQtyForCost(l)
  if (q <= 0) return 0
  const gross = q * l.unitPrice
  const discPortion =
    l.qty > 0 ? Math.max(0, l.lineDiscount) * (q / l.qty) : Math.max(0, l.lineDiscount)
  return Math.max(0, gross - discPortion)
}

const round4 = (value) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000

/**
 * Giữ biên độ giá bán so với giá vốn cũ: newPrice = round(newCost × (oldPrice / oldCost)).
 */
export function computeRetailPriceFromInboundCostChange(oldRetail, oldCost, newCost) {
  const p0 = Math.max(0, Number(oldRetail) || 0)
  const c0 = Math.max(0, Number(oldCost) || 0)
  const c1 = Math.max(0, Number(newCost) || 0)
  if (c1 <= 0) return Math.round(p0)
  if (c0 <= 0) return Math.round(Math.max(p0, c1))
  const ratio = p0 / c0
  return Math.round(c1 * ratio)
}

function aggregateInboundPurchaseByVariantId(lines) {
  const m = new Map()
  for (const raw of lines || []) {
    const ln = normalizeInboundLineForCost(raw)
    const q = inboundLineReturnableQtyForCost(ln)
    if (q <= 0 || !ln.variantId) continue
    const net = inboundLineNetPurchaseTotal(ln)
    const prev = m.get(ln.variantId) || { qty: 0, net: 0 }
    m.set(ln.variantId, { qty: prev.qty + q, net: prev.net + net })
  }
  return m
}

/**
 * @param {unknown} row — dòng `{ ma_hang, gia_von, ton_kho }` hoặc tương đương
 * @returns {{ ton: number, giaVon: number }}
 */
export function parseServerTonAndCost(row) {
  if (!row || typeof row !== 'object') return { ton: 0, giaVon: 0 }
  const tonRaw = parseStockQty(row.ton_kho)
  const ton = tonRaw != null && Number.isFinite(Number(tonRaw)) ? Math.max(0, Number(tonRaw)) : 0
  const giaVon = Math.max(0, parsePrice(row.gia_von))
  return { ton, giaVon }
}

/**
 * @param {Array<object>} catalogList — display catalog
 * @param {Array<object>} inboundFormLines — dòng phiếu (merged / form)
 * @param {Map<string, { ma_hang: string, gia_von?: unknown, ton_kho?: unknown }>} serverByMaHang
 * @param {Array<object>|null|undefined} priorOrderLines — dòng phiếu trước khi sửa (nếu có)
 * @returns {{ diffs: Array<object>, patches: Array<{ variantId: string, patch: { stockQty: number, cost: number, price: number } }> }}
 */
export function collectInboundMaHangCodes(catalogList, lines) {
  const flat = (catalogList || []).flatMap((p) => p.groupVariants || [p])
  const byId = new Map(flat.map((v) => [v.id, v]))
  const s = new Set()
  for (const raw of lines || []) {
    const ln = normalizeInboundLineForCost(raw)
    const v = byId.get(ln.variantId)
    const c = String(v?.code || ln.code || '').trim()
    if (c) s.add(c)
  }
  return [...s]
}

export function computeInboundFulfillmentPlan(
  catalogList,
  inboundFormLines,
  serverByMaHang,
  priorOrderLines
) {
  const flat = (catalogList || []).flatMap((p) => p.groupVariants || [p])
  const byVid = new Map(flat.map((v) => [v.id, v]))

  const aggNew = aggregateInboundPurchaseByVariantId(inboundFormLines)
  const aggOld = priorOrderLines?.length ? aggregateInboundPurchaseByVariantId(priorOrderLines) : new Map()

  const keys = new Set([...aggNew.keys(), ...aggOld.keys()])
  const diffs = []
  const patches = []

  for (const variantId of keys) {
    const v = byVid.get(variantId)
    if (!v) continue
    const code = String(v.code || '').trim()
    if (!code) continue

    const an = aggNew.get(variantId) || { qty: 0, net: 0 }
    const ao = aggOld.get(variantId) || { qty: 0, net: 0 }
    const deltaQ = an.qty - ao.qty
    const moneyDelta = an.net - ao.net

    if (deltaQ === 0 && Math.abs(moneyDelta) < 1e-6) continue

    const srv = serverByMaHang?.get(code)
    const serverParsed = srv ? parseServerTonAndCost(srv) : { ton: 0, giaVon: 0 }
    const fallbackTon =
      v.stockQty != null && Number.isFinite(Number(v.stockQty)) ? Math.max(0, Number(v.stockQty)) : 0
    const fallbackCost = Math.max(0, Number(v.cost) || 0)

    const baseTon = srv != null ? serverParsed.ton : fallbackTon
    const oldGiaVon = srv != null ? serverParsed.giaVon : fallbackCost

    const newTonKho = Math.max(0, baseTon + deltaQ)
    if (newTonKho <= 0) continue

    let newGiaVon
    if (baseTon <= 0) {
      if (deltaQ !== 0) newGiaVon = round4(moneyDelta / deltaQ)
      else if (an.qty > 0) newGiaVon = round4(an.net / an.qty)
      else newGiaVon = round4(oldGiaVon)
    } else {
      newGiaVon = round4((oldGiaVon * baseTon + moneyDelta) / newTonKho)
    }

    const oldRetail = Math.max(0, Number(v.price) || 0)
    const newPrice = computeRetailPriceFromInboundCostChange(oldRetail, oldGiaVon, newGiaVon)

    patches.push({
      variantId,
      patch: {
        stockQty: newTonKho,
        cost: newGiaVon,
        price: newPrice,
      },
    })

    const displayInboundUnit =
      deltaQ !== 0 ? moneyDelta / deltaQ : an.qty > 0 ? an.net / an.qty : 0

    if (round4(oldGiaVon) !== round4(newGiaVon)) {
      diffs.push({
        variantId,
        ma_hang: code,
        code,
        name: String(v.name || '').trim() || '—',
        oldCost: round4(oldGiaVon),
        inboundPrice: round4(displayInboundUnit),
        inboundQuantity: deltaQ,
        currentTonKho: baseTon,
        newCost: round4(newGiaVon),
      })
    }
  }

  return { diffs, patches }
}
