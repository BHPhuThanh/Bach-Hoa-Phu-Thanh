/**
 * Ghi nhận hoàn trả POS theo **ngày thực hiện** (atMs) để trừ Doanh thu / Tiền vốn
 * đúng ngày báo cáo, không phụ thuộc ngày tạo đơn gốc.
 */
const STORAGE_KEY = 'csv-preview-pos-return-day-ledger-v1'

function safeParseLedger(raw) {
  try {
    const j = raw ? JSON.parse(raw) : []
    if (!Array.isArray(j)) return []
    return j.filter((e) => e && typeof e.atMs === 'number' && Number.isFinite(e.revenueSub) && Number.isFinite(e.costSub))
  } catch {
    return []
  }
}

export function loadPosReturnDayLedger() {
  try {
    const rows = safeParseLedger(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

export function savePosReturnDayLedger(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch (e) {
    console.warn('[posReturnDayLedger] save', e)
  }
}

/**
 * @param {{
 *   atMs: number,
 *   orderId: string,
 *   revenueSub: number,
 *   costSub: number,
 *   sourceInvoiceNo?: string,
 *   lines?: Array<{
 *     code: string,
 *     name: string,
 *     unitLabel: string,
 *     qtyReturned: number,
 *     unitRefund: number,
 *     lineRefund: number,
 *     variantId?: string,
 *   }>,
 * }} entry
 */
export function appendPosReturnDayEntry(entry) {
  const prev = loadPosReturnDayLedger()
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `ret-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const next = [...prev, { ...entry, id }]
  savePosReturnDayLedger(next)
  return next
}

export function clearPosReturnDayLedger() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}

/**
 * @param {Array<{ atMs: number, revenueSub: number, costSub: number }>} entries
 * @param {number} startMs inclusive
 * @param {number} endMs inclusive
 */
export function sumPosReturnAdjustmentsInRange(entries, startMs, endMs) {
  let revenueSub = 0
  let costSub = 0
  if (!Array.isArray(entries) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { revenueSub, costSub }
  }
  for (const e of entries) {
    const t = Number(e.atMs)
    if (!Number.isFinite(t) || t < startMs || t > endMs) continue
    revenueSub += Math.max(0, Number(e.revenueSub) || 0)
    costSub += Math.max(0, Number(e.costSub) || 0)
  }
  return { revenueSub, costSub }
}
