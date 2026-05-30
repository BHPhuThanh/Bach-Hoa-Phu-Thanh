import { normalizePosOrder } from './posOrderAdmin.js'
import { ledgerProfitDeltaFromEntry } from './posReturnLedgerRepository.js'

/** Khoảng thời gian báo cáo trên Dashboard */
export const RANGE_TODAY = 'today'
export const RANGE_YESTERDAY = 'yesterday'
export const RANGE_LAST_7 = 'last7'
export const RANGE_LAST_30 = 'last30'
/** Từ 00:00 ngày 1 tháng hiện tại đến cuối hôm nay (theo giờ máy). */
export const RANGE_THIS_MONTH = 'thisMonth'
/** Khoảng ngày tùy chọn (chuỗi yyyy-mm-dd từ input type=date) */
export const RANGE_CUSTOM = 'custom'

export const RANGE_LABELS = {
  [RANGE_TODAY]: 'Hôm nay',
  [RANGE_YESTERDAY]: 'Hôm qua',
  [RANGE_LAST_7]: '7 ngày qua',
  [RANGE_LAST_30]: '30 ngày qua',
  [RANGE_THIS_MONTH]: 'Tháng này',
  [RANGE_CUSTOM]: 'Chọn khoảng ngày',
}

export function startOfLocalDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfLocalDay(d) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/**
 * @param {string} iso
 * @param {Date} rangeStart inclusive
 * @param {Date} rangeEnd inclusive
 */
export function isOrderInRange(iso, rangeStart, rangeEnd) {
  const t = new Date(iso).getTime()
  return t >= rangeStart.getTime() && t <= rangeEnd.getTime()
}

/**
 * @param {Array<{ createdAt: string }>} orders
 * @param {string} rangeKey RANGE_*
 */
export function filterOrdersByRange(orders, rangeKey, now = new Date()) {
  const todayStart = startOfLocalDay(now)
  const todayEnd = endOfLocalDay(now)

  if (rangeKey === RANGE_TODAY) {
    return orders.filter((o) => isOrderInRange(o.createdAt, todayStart, todayEnd))
  }
  if (rangeKey === RANGE_YESTERDAY) {
    const y = addDays(now, -1)
    return orders.filter((o) => isOrderInRange(o.createdAt, startOfLocalDay(y), endOfLocalDay(y)))
  }
  if (rangeKey === RANGE_LAST_7) {
    const start = startOfLocalDay(addDays(now, -6))
    return orders.filter((o) => isOrderInRange(o.createdAt, start, todayEnd))
  }
  if (rangeKey === RANGE_LAST_30) {
    const start = startOfLocalDay(addDays(now, -29))
    return orders.filter((o) => isOrderInRange(o.createdAt, start, todayEnd))
  }
  if (rangeKey === RANGE_THIS_MONTH) {
    const monthStart = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1))
    return orders.filter((o) => isOrderInRange(o.createdAt, monthStart, todayEnd))
  }
  if (rangeKey === RANGE_CUSTOM) {
    return orders
  }
  return orders
}

/**
 * Cửa sổ thời gian [start, end] theo preset hoặc custom (cùng logic Doanh thu / báo cáo).
 * @returns {{ start: Date, end: Date } | null}
 */
export function getReportTimeWindow(rangeKey, customFromYmd, customToYmd, now = new Date()) {
  const todayEnd = endOfLocalDay(now)
  const todayStart = startOfLocalDay(now)
  if (rangeKey === RANGE_TODAY) return { start: todayStart, end: todayEnd }
  if (rangeKey === RANGE_YESTERDAY) {
    const y = addDays(now, -1)
    return { start: startOfLocalDay(y), end: endOfLocalDay(y) }
  }
  if (rangeKey === RANGE_LAST_7) return { start: startOfLocalDay(addDays(now, -6)), end: todayEnd }
  if (rangeKey === RANGE_LAST_30) return { start: startOfLocalDay(addDays(now, -29)), end: todayEnd }
  if (rangeKey === RANGE_THIS_MONTH) {
    return { start: startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: todayEnd }
  }
  if (rangeKey === RANGE_CUSTOM) {
    const fromYmd = String(customFromYmd || '').trim()
    const toYmd = String(customToYmd || '').trim()
    const pf = fromYmd.split('-').map(Number)
    const pt = toYmd.split('-').map(Number)
    if (pf.length !== 3 || pt.length !== 3 || pf.some((n) => !Number.isFinite(n)) || pt.some((n) => !Number.isFinite(n)))
      return null
    const from = startOfLocalDay(new Date(pf[0], pf[1] - 1, pf[2]))
    const to = endOfLocalDay(new Date(pt[0], pt[1] - 1, pt[2]))
    if (from.getTime() > to.getTime()) return null
    return { start: from, end: to }
  }
  return { start: todayStart, end: todayEnd }
}

/** @param {string} fromYmd yyyy-mm-dd @param {string} toYmd yyyy-mm-dd */
export function filterOrdersByCustomDateInputs(orders, fromYmd, toYmd, now = new Date()) {
  const w = getReportTimeWindow(RANGE_CUSTOM, fromYmd, toYmd, now)
  if (!w) return []
  return orders.filter((o) => isOrderInRange(o.createdAt, w.start, w.end))
}

/**
 * @param {string} rangeKey
 * @param {string} [customFromYmd]
 * @param {string} [customToYmd]
 */
export function filterOrdersForReport(orders, rangeKey, customFromYmd, customToYmd, now = new Date()) {
  const w = getReportTimeWindow(rangeKey, customFromYmd, customToYmd, now)
  if (!w) return []
  return orders.filter((o) => isOrderInRange(o.createdAt, w.start, w.end))
}

/**
 * Bản ghi hoàn trả POS (ledger) trong cùng cửa sổ báo cáo với đơn bán.
 * @param {unknown} ledger
 */
export function filterPosReturnLedgerEntriesForReport(
  ledger,
  rangeKey,
  customFromYmd,
  customToYmd,
  now = new Date()
) {
  try {
    const w = getReportTimeWindow(rangeKey, customFromYmd, customToYmd, now)
    if (!w) return []
    const s = w.start.getTime()
    const e = w.end.getTime()
    const rows = Array.isArray(ledger) ? ledger : []
    return rows.filter((row) => {
      if (!row || typeof row !== 'object') return false
      const t = Number(row.atMs)
      return Number.isFinite(t) && t >= s && t <= e
    })
  } catch {
    return []
  }
}

/**
 * Dòng hiển thị “đơn trả hàng” trên tab Doanh thu (từ ledger, không phải đơn POS thật).
 * @param {Array<{ id?: string, invoiceNo?: string }>} orders
 * @param {Array<{ id?: string, atMs: number, orderId?: string, revenueSub: number, costSub: number, sourceInvoiceNo?: string }>} entriesInWindow
 */
export function mapReturnLedgerToRevenueDisplayRows(orders, entriesInWindow) {
  try {
    const list = Array.isArray(entriesInWindow) ? entriesInWindow : []
    const byId = new Map()
    for (const o of orders || []) {
      if (o && o.id != null) byId.set(String(o.id), o)
    }
    return list
      .map((e) => {
        const oid = String(e.orderId || '')
        const orig = byId.get(oid)
        const inv = String(e.sourceInvoiceNo || orig?.invoiceNo || '').trim()
        const baseInv = inv || oid || '—'
        const revenueSub = Math.max(0, Number(e.revenueSub) || 0)
        const profit = ledgerProfitDeltaFromEntry(e)
        const at = Number(e.atMs)
        const idKey = String(e.id != null ? e.id : '').trim() || `${at}-${oid}`
        return {
          kind: 'return',
          id: `pos-ret-${idKey}`,
          ledgerId: e.id,
          sourceOrderId: oid,
          invoiceNo: `TH-${baseInv}`,
          createdAt: Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString(),
          displayTotal: -revenueSub,
          /** Âm = giá trị profit_delta đã lưu Supabase (vd. −3.100). */
          displayProfit: profit,
        }
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch {
    return []
  }
}

function safeCreatedAtTimeMs(iso) {
  try {
    const t = new Date(iso).getTime()
    return Number.isFinite(t) ? t : 0
  } catch {
    return 0
  }
}

/**
 * Gộp đơn bán đã lọc + dòng trả hàng, sắp xếp mới → cũ theo thời gian.
 */
export function mergeRevenueTableRows(filteredOrders, returnRows) {
  try {
    const sales = (filteredOrders || []).map((o) => ({
      kind: 'sale',
      id: String(o.id != null ? o.id : ''),
      order: o,
    }))
    const ret = (returnRows || []).map((r) => ({
      kind: 'return',
      id: r.id,
      returnRow: r,
    }))
    return [...sales, ...ret].sort((a, b) => {
      const ta =
        a.kind === 'sale'
          ? safeCreatedAtTimeMs(a.order?.createdAt)
          : safeCreatedAtTimeMs(a.returnRow?.createdAt)
      const tb =
        b.kind === 'sale'
          ? safeCreatedAtTimeMs(b.order?.createdAt)
          : safeCreatedAtTimeMs(b.returnRow?.createdAt)
      return tb - ta
    })
  } catch {
    return (filteredOrders || []).map((o) => ({
      kind: 'sale',
      id: String(o.id != null ? o.id : ''),
      order: o,
    }))
  }
}

/**
 * Phiếu nhập kho: lọc theo `createdAtMs` (ms) trong cùng cửa sổ báo cáo như đơn POS.
 */
export function filterInboundOrdersForReport(rows, rangeKey, customFromYmd, customToYmd, now = new Date()) {
  const w = getReportTimeWindow(rangeKey, customFromYmd, customToYmd, now)
  if (!w) return []
  const s = w.start.getTime()
  const e = w.end.getTime()
  return (rows || []).filter((r) => {
    const t = Number(r.createdAtMs)
    return Number.isFinite(t) && t >= s && t <= e
  })
}

export function orderItemUnitCost(it) {
  if (it == null) return 0
  const c = Number(it.cost)
  return Number.isFinite(c) ? c : 0
}

export function orderLineCostTotal(it) {
  if (it == null) return 0
  if (it.lineCost != null && Number.isFinite(Number(it.lineCost))) return Number(it.lineCost)
  return orderItemUnitCost(it) * (Number(it.qty) || 0)
}

export function orderLineRevenue(it) {
  if (it == null) return 0
  if (it.lineRevenue != null && Number.isFinite(Number(it.lineRevenue))) return Number(it.lineRevenue)
  return (Number(it.price) || 0) * (Number(it.qty) || 0)
}

export function orderLineProfit(it) {
  if (it == null) return 0
  if (it.lineProfit != null && Number.isFinite(Number(it.lineProfit))) return Number(it.lineProfit)
  return orderLineRevenue(it) - orderLineCostTotal(it)
}

export function orderTotalCost(o) {
  if (o == null) return 0
  if (o.totalCost != null && Number.isFinite(Number(o.totalCost))) return Number(o.totalCost)
  return (o.items || []).reduce((s, it) => s + orderLineCostTotal(it), 0)
}

/**
 * Giá vốn báo cáo: lấy cost từng dòng sau normalize với catalog hiện tại (không dùng totalCost/lineCost đã lưu trên đơn).
 * Thuật toán normalizePosOrder giữ nguyên; chỉ bỏ qua snapshot tổng khi cộng báo cáo.
 */
export function orderReportCostFromCatalog(o, catalogList) {
  if (o == null) return orderTotalCost(o)
  const n = normalizePosOrder(o, catalogList, { preferStoredLineFinancials: false })
  if (!n?.items?.length) return orderTotalCost(o)
  return n.items.reduce((s, it) => {
    const unit = Math.max(0, Number(it.cost) || 0)
    const qty = Math.max(0, Number(it.qty) || 0)
    return s + unit * qty
  }, 0)
}

export function orderTotalProfit(o) {
  if (o == null) return 0
  if (o.totalProfit != null && Number.isFinite(Number(o.totalProfit))) return Number(o.totalProfit)
  return (Number(o.total) || 0) - orderTotalCost(o)
}
