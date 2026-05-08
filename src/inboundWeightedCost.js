/**
 * Bình quân gia quyền khi nhập hàng + cộng dồn tồn — không đổi giá bán (gia_ban).
 * Dùng tồn/giá vốn từ Supabase khi có; hỗ trợ phiếu mới và chỉnh sửa (so với dòng cũ).
 */

import { parsePrice, parseStockQty } from './catalogCsv.js'
import { normalizeGroupRoot } from './productUnits.js'

function createInboundLineId() {
  return `il-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function parseNumberVi(raw) {
  const s0 = String(raw ?? '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/\s/g, '')
    .replace(/đ/gi, '')
  if (!s0) return 0
  let s = s0.replace(/[^\d.,-]/g, '')
  if (!s) return 0
  const neg = s.startsWith('-')
  s = s.replace(/^-/, '')
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let out = s
  if (lastDot >= 0 && lastComma >= 0) {
    // VN phổ biến: '.' phân nghìn, ',' thập phân
    out = s.replace(/\./g, '').replace(/,/g, '.')
  } else if (lastComma >= 0) {
    const tail = s.slice(lastComma + 1)
    out = tail.length === 3 ? s.replace(/,/g, '') : s.replace(/,/g, '.')
  } else if (lastDot >= 0) {
    const tail = s.slice(lastDot + 1)
    out = tail.length === 3 ? s.replace(/\./g, '') : s
  }
  const n = Number(out)
  if (!Number.isFinite(n)) return 0
  return neg ? -n : n
}

function parseMoneyVi(raw) {
  const d = String(raw ?? '').replace(/[^\d]/g, '')
  if (!d) return 0
  const n = parseInt(d, 10)
  return Number.isFinite(n) ? n : 0
}

export function normalizeInboundLineForCost(x) {
  const qty = Math.max(0, parseNumberVi(x.qty))
  let returnedQty = Math.max(0, parseNumberVi(x.returnedQty))
  if (returnedQty > qty) returnedQty = qty
  return {
    lineId: String(x.lineId || createInboundLineId()),
    variantId: String(x.variantId || ''),
    code: String(x.code ?? '').trim(),
    name: String(x.name ?? '').trim(),
    unitLabel: String(x.unitLabel ?? '').trim(),
    qty,
    returnedQty,
    unitPrice: Math.max(0, parseMoneyVi(x.unitPrice)),
    lineDiscount: Math.max(0, parseMoneyVi(x.lineDiscount)),
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
  const oldQtyNum = Math.max(0, parseNumberVi(oldQty))
  const oldCostNum = Math.max(0, parseNumberVi(oldCost))
  const inboundQtyNum = Math.max(0, parseNumberVi(inboundQty))
  const inboundUnitCostNum = Math.max(0, parseNumberVi(inboundUnitCost))
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

function parseGroupServerSnapshot(members, serverByMaHang) {
  let totalBaseQty = 0
  let totalValue = 0
  let seenAnyServer = false
  for (const member of members || []) {
    const code = String(member?.code || '').trim()
    if (!code) continue
    const srv = serverByMaHang?.get(code)
    if (!srv) continue
    seenAnyServer = true
    const { ton, giaVon } = parseServerTonAndCost(srv)
    const conv = conversionToBaseForVariant(member, srv)
    const qtyAtThisUnit = Math.max(0, Number(ton) || 0)
    const costAtThisUnit = Math.max(0, Number(giaVon) || 0)
    totalBaseQty += qtyAtThisUnit * conv
    totalValue += qtyAtThisUnit * costAtThisUnit
  }
  if (!seenAnyServer || totalBaseQty <= 0) return { hasServer: false, baseQty: 0, baseCost: 0 }
  return {
    hasServer: true,
    baseQty: totalBaseQty,
    baseCost: totalValue / totalBaseQty,
  }
}

function aggregateInboundPurchaseByGroupRoot(lines, byVid, serverByMaHang) {
  const m = new Map()
  const byVariant = new Map()
  const byVariantEnteredUnitPrice = new Map()
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

    const pv = byVariant.get(ln.variantId) || { qty: 0, net: 0 }
    byVariant.set(ln.variantId, { qty: pv.qty + q, net: pv.net + net })

    const pu = byVariantEnteredUnitPrice.get(ln.variantId) || { qty: 0, sum: 0 }
    byVariantEnteredUnitPrice.set(ln.variantId, {
      qty: pu.qty + q,
      sum: pu.sum + q * Math.max(0, parseMoneyVi(raw?.unitPrice ?? ln.unitPrice)),
    })
  }
  return { byRoot: m, byVariant, byVariantEnteredUnitPrice }
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
    : { byRoot: new Map(), byVariant: new Map(), byVariantEnteredUnitPrice: new Map() }

  const keys = new Set([...aggNew.byRoot.keys(), ...aggOld.byRoot.keys()])
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

    const an = aggNew.byRoot.get(root) || { qty: 0, net: 0 }
    const ao = aggOld.byRoot.get(root) || { qty: 0, net: 0 }
    const deltaQ = an.qty - ao.qty
    const moneyDelta = an.net - ao.net

    if (deltaQ === 0 && Math.abs(moneyDelta) < 1e-6) continue

    const srvGroup = parseGroupServerSnapshot(members, serverByMaHang)
    const fallbackBaseTon = members.reduce((acc, v) => {
      const n = Number(v?.stockQty)
      return Number.isFinite(n) && n > acc ? n : acc
    }, 0)
    const fallbackBaseCost = members.reduce((acc, v) => {
      const conv = conversionToBaseForVariant(v, null)
      const n = Number(v?.cost)
      if (!Number.isFinite(n) || n < 0) return acc
      const baseCost = n / conv
      return Number.isFinite(baseCost) && baseCost > 0 ? Math.max(acc, baseCost) : acc
    }, 0)

    const oldBaseQty = srvGroup.hasServer ? srvGroup.baseQty : fallbackBaseTon
    const oldBaseCost = srvGroup.hasServer ? srvGroup.baseCost : fallbackBaseCost
    const newBaseQty = Math.max(0, oldBaseQty + deltaQ)
    if (newBaseQty <= 0) continue

    const inboundBaseUnitCost = deltaQ !== 0 ? moneyDelta / deltaQ : 0
    const newBaseCost = calculateWeightedAverage(
      oldBaseQty,
      oldBaseCost,
      deltaQ,
      inboundBaseUnitCost
    )

    const keepExactInboundCostByVariantId = new Map()
    for (const [vid, nn] of aggNew.byVariant.entries()) {
      const oo = aggOld.byVariant.get(vid) || { qty: 0, net: 0 }
      const dq = (Number(nn.qty) || 0) - (Number(oo.qty) || 0)
      const dm = (Number(nn.net) || 0) - (Number(oo.net) || 0)
      if (dq <= 0) continue
      const v = byVid.get(vid)
      if (!v) continue
      const r = lineGroupRootOfVariant(v)
      if (r !== root) continue
      const entered = aggNew.byVariantEnteredUnitPrice.get(vid)
      const keep = entered?.qty > 0 ? entered.sum / entered.qty : dm / dq
      keepExactInboundCostByVariantId.set(vid, keep)
    }

    for (const member of members) {
      if (!member?.id) continue
      const memberSrv = serverByMaHang?.get(String(member.code || '').trim())
      const conv = conversionToBaseForVariant(member, memberSrv)
      const keep = keepExactInboundCostByVariantId.get(member.id)
      patches.push({
        variantId: member.id,
        patch: {
          stockQty: newBaseQty,
          cost: round4(keep != null ? keep : newBaseCost * conv),
        },
      })
    }

    const displayInboundUnit =
      deltaQ !== 0 ? moneyDelta / deltaQ : an.qty > 0 ? an.net / an.qty : 0

    const repSrv = serverByMaHang?.get(repCode)
    const repConv = conversionToBaseForVariant(rep, repSrv)
    const oldRepCost = round4(oldBaseCost * repConv)
    const newRepCost = round4(newBaseCost * repConv)
    if (oldRepCost !== newRepCost) {
      diffs.push({
        variantId: rep.id,
        ma_hang: repCode,
        code: repCode,
        name: String(rep.name || '').trim() || '—',
        oldCost: oldRepCost,
        inboundPrice: round4(displayInboundUnit),
        inboundQuantity: deltaQ,
        currentTonKho: oldBaseQty,
        newCost: newRepCost,
      })
    }
  }

  return { diffs, patches }
}
