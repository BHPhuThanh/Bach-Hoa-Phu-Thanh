/**
 * Bình quân gia quyền khi nhập hàng + cộng dồn tồn — không đổi giá bán (gia_ban).
 * Dùng tồn/giá vốn từ Supabase khi có; hỗ trợ phiếu mới và chỉnh sửa (so với dòng cũ).
 */

import { parsePrice, parseStockQty } from './catalogCsv.js'
import { normalizeGroupRoot } from './productUnits.js'

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

function resolvePositiveNumber(...vals) {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 1
}

export function calculateWeightedAverage(oldQty, oldCost, inboundQty, inboundUnitCost) {
  const oldQtyNum = Math.max(0, Number(oldQty) || 0)
  const oldCostNum = Math.max(0, Number(oldCost) || 0)
  const inboundQtyNum = Math.max(0, Number(inboundQty) || 0)
  const inboundUnitCostNum = Math.max(0, Number(inboundUnitCost) || 0)
  const totalQty = oldQtyNum + inboundQtyNum
  if (totalQty <= 0) return round4(oldCostNum)
  const weighted = (oldQtyNum * oldCostNum + inboundQtyNum * inboundUnitCostNum) / totalQty
  return round4(weighted)
}

function lineGroupRootOfVariant(v, fallbackCode = '') {
  const code = String(v?.code || fallbackCode || '').trim()
  const linked = String(v?.linkedMasterCode || '').trim()
  if (!code) return ''
  return normalizeGroupRoot(code, linked)
}

function conversionToBaseForVariant(v, serverRow) {
  return resolvePositiveNumber(
    v?.conversionValue,
    v?.conversion,
    v?.quy_doi,
    v?.raw?.quy_doi,
    serverRow?.quy_doi,
    1
  )
}

function aggregateInboundPurchaseByGroupRoot(lines, byVid, serverByMaHang) {
  const m = new Map()
  for (const raw of lines || []) {
    const ln = normalizeInboundLineForCost(raw)
    const q = inboundLineReturnableQtyForCost(ln)
    if (q <= 0 || !ln.variantId) continue
    const v = byVid.get(ln.variantId)
    if (!v) continue
    const root = lineGroupRootOfVariant(v, ln.code)
    if (!root) continue
    const net = inboundLineNetPurchaseTotal(ln)
    const srv = serverByMaHang?.get(String(v.code || '').trim())
    const conv = conversionToBaseForVariant(v, srv)
    const baseQty = q * conv
    const prev = m.get(root) || { qty: 0, net: 0 }
    m.set(root, { qty: prev.qty + baseQty, net: prev.net + net })
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
 * @returns {{ diffs: Array<object>, patches: Array<{ variantId: string, patch: { stockQty: number, cost: number } }> }}
 */
export function collectInboundMaHangCodes(catalogList, lines) {
  const flat = (catalogList || []).flatMap((p) => p.groupVariants || [p])
  const byId = new Map(flat.map((v) => [v.id, v]))
  const byRoot = new Map()
  for (const v of flat) {
    const root = lineGroupRootOfVariant(v)
    if (!root) continue
    const prev = byRoot.get(root) || []
    prev.push(v)
    byRoot.set(root, prev)
  }
  const s = new Set()
  for (const raw of lines || []) {
    const ln = normalizeInboundLineForCost(raw)
    const v = byId.get(ln.variantId)
    const root = v ? lineGroupRootOfVariant(v, ln.code) : ''
    if (!root) {
      const c = String(v?.code || ln.code || '').trim()
      if (c) s.add(c)
      continue
    }
    for (const member of byRoot.get(root) || []) {
      const c = String(member?.code || '').trim()
      if (c) s.add(c)
    }
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
  const groupMembers = new Map()
  for (const v of flat) {
    const root = lineGroupRootOfVariant(v)
    if (!root) continue
    const prev = groupMembers.get(root) || []
    prev.push(v)
    groupMembers.set(root, prev)
  }

  const aggNew = aggregateInboundPurchaseByGroupRoot(inboundFormLines, byVid, serverByMaHang)
  const aggOld = priorOrderLines?.length
    ? aggregateInboundPurchaseByGroupRoot(priorOrderLines, byVid, serverByMaHang)
    : new Map()

  const keys = new Set([...aggNew.keys(), ...aggOld.keys()])
  const diffs = []
  const patches = []

  for (const root of keys) {
    const members = groupMembers.get(root) || []
    if (!members.length) continue
    const rep = [...members].sort((a, b) => {
      const ac = conversionToBaseForVariant(a, serverByMaHang?.get(String(a?.code || '').trim()))
      const bc = conversionToBaseForVariant(b, serverByMaHang?.get(String(b?.code || '').trim()))
      if (ac !== bc) return ac - bc
      return String(a?.code || '').localeCompare(String(b?.code || ''), 'vi')
    })[0]
    if (!rep) continue
    const repCode = String(rep.code || '').trim()
    if (!repCode) continue

    const an = aggNew.get(root) || { qty: 0, net: 0 }
    const ao = aggOld.get(root) || { qty: 0, net: 0 }
    const deltaQ = an.qty - ao.qty
    const moneyDelta = an.net - ao.net

    if (deltaQ === 0 && Math.abs(moneyDelta) < 1e-6) continue

    const srv = serverByMaHang?.get(repCode)
    const serverParsed = srv ? parseServerTonAndCost(srv) : { ton: 0, giaVon: 0 }
    const fallbackTon = members.reduce((acc, v) => {
      const n = Number(v?.stockQty)
      return Number.isFinite(n) && n > acc ? n : acc
    }, 0)
    const fallbackCost = members.reduce((acc, v) => {
      const n = Number(v?.cost)
      return Number.isFinite(n) && n > acc ? n : acc
    }, 0)

    const baseTon = srv != null ? serverParsed.ton : fallbackTon
    const oldGiaVon = srv != null ? serverParsed.giaVon : fallbackCost
    const newTonKho = Math.max(0, baseTon + deltaQ)
    if (newTonKho <= 0) continue

    const inboundUnitCost = deltaQ !== 0 ? moneyDelta / deltaQ : 0
    const newGiaVon = calculateWeightedAverage(baseTon, oldGiaVon, deltaQ, inboundUnitCost)
    for (const member of members) {
      if (!member?.id) continue
      patches.push({
        variantId: member.id,
        patch: {
          stockQty: newTonKho,
          cost: newGiaVon,
        },
      })
    }

    const displayInboundUnit =
      deltaQ !== 0 ? moneyDelta / deltaQ : an.qty > 0 ? an.net / an.qty : 0

    if (round4(oldGiaVon) !== round4(newGiaVon)) {
      diffs.push({
        variantId: rep.id,
        ma_hang: repCode,
        code: repCode,
        name: String(rep.name || '').trim() || '—',
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
