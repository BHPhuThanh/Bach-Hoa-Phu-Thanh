import { resolvePosItemVariantId } from './posOrderAdmin.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'

function normInboundLine(x) {
  return {
    variantId: String(x?.variantId ?? '').trim(),
    qty: Math.max(0, Number(x?.qty) || 0),
    returnedQty: Math.max(0, Number(x?.returnedQty) || 0),
  }
}

function kindOrder(kind) {
  const o = { pos_sale: 0, inbound_receipt: 1, inbound_return: 2, pos_return: 3 }
  return o[kind] ?? 9
}

function resolveItemVariantId(catalogList, item) {
  const e = String(item?.variantId ?? '').trim()
  if (e) return e
  return String(resolvePosItemVariantId(catalogList, item) || '').trim()
}

function formatDeltaVi(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x === 0) return '0'
  const body = Math.abs(x).toLocaleString('vi-VN', { maximumFractionDigits: 6 })
  return x > 0 ? `+${body}` : `-${body}`
}

function formatBalanceVi(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  if (Math.abs(x - Math.round(x)) < 1e-9) return Math.round(x).toLocaleString('vi-VN')
  return x.toLocaleString('vi-VN', { maximumFractionDigits: 6 })
}

function buildDocLink(ev) {
  if (ev.kind === 'pos_return' && ev.returnLedgerId) {
    return { type: 'pos_return', returnLedgerId: String(ev.returnLedgerId), docNo: ev.docNo }
  }
  if (ev.kind === 'pos_sale' && ev.posOrderId) {
    return { type: 'pos', posOrderId: String(ev.posOrderId), docNo: ev.docNo }
  }
  if ((ev.kind === 'inbound_receipt' || ev.kind === 'inbound_return') && ev.inboundOrderId) {
    return { type: 'inbound', inboundOrderId: String(ev.inboundOrderId), docNo: ev.docNo }
  }
  return null
}

/**
 * Dựng thẻ kho cho một biến thể: gồm bán lẻ, hoàn trả POS, nhập kho, trả NCC.
 * Tồn sau dòng cuối (theo thời gian) được căn chỉnh về `currentStockQty` khi có số liệu tồn hiện tại.
 */
export function buildVariantStockLedgerRows({
  variantId,
  catalogList,
  currentStockQty,
  orders = [],
  inboundOrders = [],
  returnDayLedger = [],
}) {
  const vid = String(variantId || '').trim()
  if (!vid) return []

  const flat = (catalogList || []).flatMap((p) => p.groupVariants || [p])
  const self = flat.find((v) => String(v.id) === vid)
  const myCode = String(self?.code || '').trim()
  const myUnit = normalizeCatalogUnitLabel(self?.unitLabel || '')

  /** @type {Array<{ t: number, kind: string, staff: string, action: string, delta: number, docNo: string, posOrderId?: string|null, inboundOrderId?: string|null, returnLedgerId?: string|null }>} */
  const events = []

  for (const ord of orders) {
    if (!ord || String(ord.status) === 'cancelled') continue
    const t = new Date(ord.createdAt).getTime()
    if (!Number.isFinite(t)) continue
    const inv = String(ord.invoiceNo || '').trim()
    for (const it of ord.items || []) {
      const rv = resolveItemVariantId(catalogList, it)
      if (rv !== vid) continue
      const qty = Math.max(0, Number(it.qty) || 0)
      if (qty <= 0) continue
      events.push({
        t,
        kind: 'pos_sale',
        staff: '—',
        action: 'Bán lẻ',
        delta: -qty,
        docNo: inv || '—',
        posOrderId: String(ord.id || ''),
        inboundOrderId: null,
        returnLedgerId: null,
      })
    }
  }

  const led = Array.isArray(returnDayLedger) ? returnDayLedger : []
  for (const e of led) {
    const t = Number(e.atMs)
    if (!Number.isFinite(t)) continue
    const lines = Array.isArray(e.lines) ? e.lines : []
    const srcInv = String(e.sourceInvoiceNo || '').trim()
    const docNo = `TH-${srcInv || '—'}`
    for (const ln of lines) {
      const q = Math.max(0, Number(ln.qtyReturned) || 0)
      if (q <= 0) continue
      let lineVid = String(ln.variantId || '').trim()
      if (!lineVid && myCode) {
        const lc = String(ln.code || '').trim()
        const lu = normalizeCatalogUnitLabel(ln.unitLabel || '')
        if (lc === myCode && lu === myUnit) lineVid = vid
      }
      if (lineVid !== vid) continue
      events.push({
        t,
        kind: 'pos_return',
        staff: '—',
        action: 'Hoàn trả',
        delta: q,
        docNo,
        posOrderId: String(e.orderId || ''),
        inboundOrderId: null,
        returnLedgerId: e.id != null ? String(e.id) : null,
      })
    }
  }

  for (const row of inboundOrders || []) {
    const st = String(row.status || '')
    if (st === 'cancelled' || st === 'saved_temp') continue
    const t = Number(row.createdAtMs)
    if (!Number.isFinite(t)) continue
    const docNo = String(row.code || '').trim() || '—'
    const oid = String(row.id || '')
    for (const raw of row.lines || []) {
      const ln = normInboundLine(raw)
      if (ln.variantId !== vid) continue
      if (ln.qty > 0) {
        events.push({
          t,
          kind: 'inbound_receipt',
          staff: '—',
          action: 'Nhập hàng',
          delta: ln.qty,
          docNo,
          posOrderId: null,
          inboundOrderId: oid,
          returnLedgerId: null,
        })
      }
      if (ln.returnedQty > 0) {
        events.push({
          t: t + 1,
          kind: 'inbound_return',
          staff: '—',
          action: 'Trả hàng NCC',
          delta: -ln.returnedQty,
          docNo,
          posOrderId: null,
          inboundOrderId: oid,
          returnLedgerId: null,
        })
      }
    }
  }

  events.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t
    const d = kindOrder(a.kind) - kindOrder(b.kind)
    if (d !== 0) return d
    return String(a.docNo).localeCompare(String(b.docNo), 'vi')
  })

  const sumD = events.reduce((s, e) => s + e.delta, 0)
  const curN = Number(currentStockQty)
  const curOk = Number.isFinite(curN)
  let run = curOk ? curN - sumD : 0 - sumD

  const enriched = events.map((e) => {
    run += e.delta
    return { ...e, balanceAfter: run }
  })

  if (curOk && enriched.length) {
    const last = enriched[enriched.length - 1].balanceAfter
    if (Math.abs(last - curN) > 1e-4) {
      console.warn('[stockLedgerForVariant] Số dư sau giao dịch lệch so với tồn danh mục — có thể thiếu chứng từ hoặc chỉnh tồn tay.', {
        variantId: vid,
        catalogStock: curN,
        computedLast: last,
        sumD,
      })
    }
  }

  const formatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

  function safeLedgerDateLabel(ms) {
    const t = Number(ms)
    if (!Number.isFinite(t)) return '—'
    try {
      const d = new Date(t)
      if (Number.isNaN(d.getTime())) return '—'
      return formatter.format(d)
    } catch {
      return '—'
    }
  }

  return enriched
    .map((e, idx) => {
      const deltaN = Number.isFinite(Number(e.delta)) ? Number(e.delta) : 0
      return {
        key: `${e.kind}-${e.t}-${idx}`,
        dateLabel: safeLedgerDateLabel(e.t),
        staff: String(e.staff ?? '—'),
        action: String(e.action ?? '—'),
        delta: deltaN,
        deltaLabel: formatDeltaVi(deltaN),
        balanceLabel: formatBalanceVi(e.balanceAfter),
        docNo: String(e.docNo ?? '—'),
        docLink: buildDocLink(e),
      }
    })
    .reverse()
}
