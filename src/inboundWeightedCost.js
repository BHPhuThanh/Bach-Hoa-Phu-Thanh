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
  // Hỗ trợ cả chuỗi thập phân legacy (vd: 4883.333) nhưng luôn làm tròn về VNĐ nguyên.
  return Math.round(parsePrice(raw))
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

const fixed4Number = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Number(parseFloat(String(n)).toFixed(4))
}

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
  if (totalQty <= 0) return Math.round(oldCostNum)
  const weighted = (oldQtyNum * oldCostNum + inboundQtyNum * inboundUnitCostNum) / totalQty
  return Math.round(weighted)
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

/** Ghép dòng phiếu ↔ biến thể danh mục — ưu tiên `variantId`; nếu lệch id (vd. UUID client vs `sb-…` sau revalidate Supabase) thì khớp theo mã hàng. */
function findCatalogVariantForInboundLine(ln, byVid, flat) {
  const vid = String(ln.variantId || '').trim()
  if (vid) {
    const hit = byVid.get(vid)
    if (hit) return hit
  }
  const code = String(ln.code ?? '').trim()
  if (!code) return null
  const codeLc = code.toLowerCase()
  for (const vv of flat || []) {
    if (String(vv?.code ?? '').trim().toLowerCase() === codeLc) return vv
  }
  return null
}

function parseGroupServerSnapshot(primaryMember, members, serverByMaHang) {
  const ordered = []
  if (primaryMember) ordered.push(primaryMember)
  for (const m of members || []) {
    if (!m || (primaryMember && m.id === primaryMember.id)) continue
    ordered.push(m)
  }
  for (const member of ordered) {
    const code = String(member?.code || '').trim()
    if (!code) continue
    const srv = serverByMaHang?.get(code)
    if (!srv) continue
    const { ton, giaVon } = parseServerTonAndCost(srv)
    const conv = conversionToBaseForVariant(member, srv)
    const qtyAtThisUnit = Math.max(0, Number(ton) || 0)
    const costAtThisUnit = Math.max(0, Number(giaVon) || 0)
    return {
      hasServer: true,
      baseQty: qtyAtThisUnit * conv,
      // gia_von đang lưu theo đơn vị hiện tại -> chuẩn hóa về đơn vị cơ bản.
      baseCost: costAtThisUnit / conv,
    }
  }
  return { hasServer: false, baseQty: 0, baseCost: 0 }
}

function aggregateInboundPurchaseByGroupRoot(lines, byVid, serverByMaHang, flat) {
  const m = new Map()
  for (const raw of lines || []) {
    const ln = normalizeInboundLineForCost(raw)
    const q = inboundLineReturnableQtyForCost(ln)
    if (q <= 0) continue
    if (!ln.variantId) {
      // eslint-disable-next-line no-console
      console.warn('Dòng bị từ chối:', raw, 'Lý do: thiếu variantId')
      continue
    }
    const v = findCatalogVariantForInboundLine(ln, byVid, flat)
    if (!v) {
      // eslint-disable-next-line no-console
      console.warn(
        'Dòng bị từ chối:',
        raw,
        'Lý do: không tìm thấy biến thể trong danh mục (sai ID sau đồng bộ Supabase hoặc lệch ma_hang)',
        { variantId: ln.variantId, ma_hang_line: ln.code }
      )
      continue
    }
    const root = lineGroupRootOfVariant(v, ln.code)
    if (!root) {
      // eslint-disable-next-line no-console
      console.warn(
        'Dòng bị từ chối:',
        raw,
        'Lý do: không tính được nhóm mã (thiếu/không hợp lệ ma_hang trên danh mục)',
        { catalog_ma_hang: v?.code }
      )
      continue
    }
    const net = inboundLineNetPurchaseTotal(ln)
    const srv = serverByMaHang?.get(String(v.code || '').trim())
    const conv = conversionToBaseForVariant(v, srv)
    const baseQty = q * conv
    const prev = m.get(root) || { qty: 0, net: 0 }
    m.set(root, { qty: prev.qty + baseQty, net: prev.net + net })
  }
  return { byRoot: m }
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
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  const byId = new Map(flat.map((v) => [String(v.id), v]))
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
    let v = byId.get(String(ln.variantId)) ?? byId.get(ln.variantId)
    if (!v) {
      const codeLc = String(ln.code ?? '').trim().toLowerCase()
      if (codeLc) v = flat.find((x) => String(x?.code ?? '').trim().toLowerCase() === codeLc)
    }
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
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  const byVid = new Map(flat.map((v) => [String(v.id), v]))
  const groupMembers = new Map()
  for (const v of flat) {
    const root = lineGroupRootOfVariant(v)
    if (!root) continue
    const prev = groupMembers.get(root) || []
    prev.push(v)
    groupMembers.set(root, prev)
  }

  const aggNew = aggregateInboundPurchaseByGroupRoot(inboundFormLines, byVid, serverByMaHang, flat)
  const aggOld = priorOrderLines?.length
    ? aggregateInboundPurchaseByGroupRoot(priorOrderLines, byVid, serverByMaHang, flat)
    : { byRoot: new Map() }

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

    const srvGroup = parseGroupServerSnapshot(rep, members, serverByMaHang)
    const fallbackBaseTon = members.reduce((acc, v) => {
      const n = Number(v?.stockQty)
      if (!Number.isFinite(n) || n < 0) return acc
      const conv = conversionToBaseForVariant(v, null)
      return Math.max(acc, n * conv)
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

    for (const member of members) {
      if (!member?.id) continue
      const memberSrv = serverByMaHang?.get(String(member.code || '').trim())
      const conv = conversionToBaseForVariant(member, memberSrv)
      patches.push({
        variantId: member.id,
        patch: {
          // Single source of truth: luôn lưu ton_kho theo đơn vị cơ bản cho mọi SKU cùng nhóm.
          stockQty: fixed4Number(newBaseQty),
          // một giá vốn cơ bản cho họ — gia_von ĐVT = giá vốn cơ bản × quy_doi (không gán đè bằng đơn giá 0đ từng dòng nhập).
          cost: Math.round(newBaseCost * conv),
          ton_nho_nhat: Number(member?.ton_nho_nhat ?? memberSrv?.ton_nho_nhat ?? 0),
        },
      })
    }

    const displayInboundUnit =
      deltaQ !== 0 ? moneyDelta / deltaQ : an.qty > 0 ? an.net / an.qty : 0

    const repSrv = serverByMaHang?.get(repCode)
    const repConv = conversionToBaseForVariant(rep, repSrv)
    const oldRepCost = Math.round(oldBaseCost * repConv)
    const newRepCost = Math.round(newBaseCost * repConv)
    if (oldRepCost !== newRepCost) {
      diffs.push({
        variantId: rep.id,
        ma_hang: repCode,
        code: repCode,
        name: String(rep.name || '').trim() || '—',
        oldCost: oldRepCost,
        inboundPrice: Math.round(displayInboundUnit),
        inboundQuantity: deltaQ,
        currentTonKho: oldBaseQty,
        newCost: newRepCost,
      })
    }
  }

  return { diffs, patches }
}
