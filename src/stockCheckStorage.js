/** Phiếu kiểm hàng — lưu localStorage, tách khỏi catalog 10k dòng (mảng nhỏ). */

export const STOCK_CHECK_STORAGE_KEY = 'csv-preview-stock-check-vouchers-v1'

/** Giới hạn số phiếu lưu để tránh phình localStorage. */
const MAX_VOUCHERS = 3000

/**
 * @typedef {Object} StockCheckLine
 * @property {string} variantId
 * @property {string} productName
 * @property {string} productCode
 * @property {string} unitLabel
 * @property {number|null} branchQty
 * @property {number|null} actualQty
 * @property {number|null} deltaQty
 * @property {string} reason
 * @property {string} [note]
 */

/**
 * @typedef {Object} StockCheckVoucher
 * @property {string} id
 * @property {string} code
 * @property {'hoan_thanh'|'da_huy'} status
 * @property {number} createdAtMs
 * @property {number|null} balancedAtMs
 * @property {string} createdBy
 * @property {StockCheckLine[]} lines
 * @property {string} [note]
 * @property {string} [branchLabel]
 */

function safeParse(raw) {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function loadStockCheckVouchers() {
  if (typeof window === 'undefined') return []
  try {
    return safeParse(window.localStorage.getItem(STOCK_CHECK_STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

/** @param {StockCheckVoucher[]} rows */
export function saveStockCheckVouchers(rows) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STOCK_CHECK_STORAGE_KEY, JSON.stringify(rows))
  } catch {
    /* ignore quota */
  }
}

function nextVoucherCode(list) {
  let max = 0
  for (const v of list) {
    const m = /^PK(\d+)$/i.exec(String(v?.code ?? ''))
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  const n = max + 1
  return `PK${String(n).padStart(3, '0')}`
}

function normalizeComparableStock(q) {
  if (q == null || q === '') return null
  const n = typeof q === 'number' ? q : Number(String(q).trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** So sánh tồn trước/sau (null = chưa có số). */
export function stockQtyMeaningfullyChanged(beforeRaw, afterRaw) {
  const b = normalizeComparableStock(beforeRaw)
  const a = normalizeComparableStock(afterRaw)
  if (b === null && a === null) return false
  if (b === null || a === null) return true
  return b !== a
}

/**
 * Thêm phiếu hoàn thành (tự động khi chỉnh tồn Hàng hóa).
 * @param {StockCheckVoucher[]} prev
 * @param {{
 *   variantId: string
 *   productName: string
 *   productCode: string
 *   unitLabel: string
 *   beforeQty: unknown
 *   afterQty: unknown
 *   createdBy: string
 * }} line
 * @returns {StockCheckVoucher[]}
 */
export function appendAutoCompletedStockCheck(prev, line) {
  const list = Array.isArray(prev) ? [...prev] : []
  const now = Date.now()
  const branchQty = normalizeComparableStock(line.beforeQty)
  const actualQty = normalizeComparableStock(line.afterQty)
  const delta =
    branchQty != null && actualQty != null
      ? actualQty - branchQty
      : actualQty != null && branchQty == null
        ? actualQty
        : branchQty != null && actualQty == null
          ? -branchQty
          : null

  const voucher = {
    id: `sc_${now}_${Math.random().toString(36).slice(2, 9)}`,
    code: nextVoucherCode(list),
    status: 'hoan_thanh',
    createdAtMs: now,
    balancedAtMs: now,
    createdBy: String(line.createdBy || '').trim() || '—',
    lines: [
      {
        variantId: String(line.variantId || '').trim(),
        productName: String(line.productName || '').trim() || '—',
        productCode: String(line.productCode || '').trim() || '—',
        unitLabel: String(line.unitLabel || '').trim() || '—',
        branchQty,
        actualQty,
        deltaQty: delta,
        reason: 'Điều chỉnh tồn',
        note: '',
      },
    ],
  }
  list.push(voucher)
  if (list.length > MAX_VOUCHERS) list.splice(0, list.length - MAX_VOUCHERS)
  return list
}

/**
 * Phiếu tạo tay (trạng thái Đã hủy — placeholder theo nút "+ Tạo phiếu kiểm").
 * @param {StockCheckVoucher[]} prev
 * @param {string} createdBy
 */
export function appendManualCancelledPlaceholder(prev, createdBy) {
  const list = Array.isArray(prev) ? [...prev] : []
  const now = Date.now()
  const voucher = {
    id: `sc_${now}_${Math.random().toString(36).slice(2, 9)}`,
    code: nextVoucherCode(list),
    status: 'da_huy',
    createdAtMs: now,
    balancedAtMs: null,
    createdBy: String(createdBy || '').trim() || '—',
    lines: [],
  }
  list.push(voucher)
  if (list.length > MAX_VOUCHERS) list.splice(0, list.length - MAX_VOUCHERS)
  return list
}

/** Mã phiếu kế tiếp (chỉ đọc, không ghi). */
export function peekNextStockCheckCode(list) {
  return nextVoucherCode(Array.isArray(list) ? list : [])
}

/**
 * Phiếu hoàn thành từ màn «Tạo phiếu kiểm hàng» (nhiều dòng).
 * @param {StockCheckVoucher[]} prevList
 * @param {{ createdBy: string; lines: StockCheckLine[]; note?: string; branchLabel?: string }} payload
 */
export function createHoanThanhStockCheckVoucher(prevList, payload) {
  const list = Array.isArray(prevList) ? prevList : []
  const now = Date.now()
  const lines = Array.isArray(payload.lines) ? payload.lines : []
  const voucher = {
    id: `sc_${now}_${Math.random().toString(36).slice(2, 9)}`,
    code: nextVoucherCode(list),
    status: 'hoan_thanh',
    createdAtMs: now,
    balancedAtMs: now,
    createdBy: String(payload.createdBy || '').trim() || '—',
    lines,
  }
  if (payload.note != null && String(payload.note).trim() !== '') {
    voucher.note = String(payload.note).trim()
  }
  if (payload.branchLabel != null && String(payload.branchLabel).trim() !== '') {
    voucher.branchLabel = String(payload.branchLabel).trim()
  }
  return voucher
}

/** @param {StockCheckVoucher[]} prev */
export function appendStockCheckVoucher(prev, voucher) {
  const list = Array.isArray(prev) ? [...prev] : []
  list.push(voucher)
  if (list.length > MAX_VOUCHERS) list.splice(0, list.length - MAX_VOUCHERS)
  return list
}
