/**
 * Phiếu điều chỉnh giá vốn — đọc/ghi qua IndexedDB.
 * Sau này có Server: thay load/save bằng fetch API, giữ cùng hình dạng mảng phiếu.
 */

import { idbGetCostAdjustVouchers, idbPutCostAdjustVouchers } from './costAdjustIndexedDb.js'

export const COST_ADJUST_SYNC_BUMP_KEY = 'csv-preview-cost-adjust-sync-bump-v1'

const MAX_VOUCHERS = 3000

/**
 * @typedef {Object} CostAdjustLine
 * @property {string} variantId
 * @property {string} productCode
 * @property {string} productName
 * @property {string} unitLabel
 * @property {number} oldCost
 * @property {number} newCost
 */

/**
 * @typedef {Object} CostAdjustVoucher
 * @property {string} id
 * @property {string} code
 * @property {'hoan_thanh'|'da_huy'} status
 * @property {number} createdAtMs
 * @property {number|null} adjustedAtMs
 * @property {string} createdBy
 * @property {CostAdjustLine[]} lines
 */

function bumpSync() {
  try {
    localStorage.setItem(COST_ADJUST_SYNC_BUMP_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** @returns {Promise<CostAdjustVoucher[]>} */
export async function loadCostAdjustVouchersFromStore() {
  const rows = await idbGetCostAdjustVouchers()
  return Array.isArray(rows) ? rows : []
}

/** @param {CostAdjustVoucher[]} rows */
export async function saveCostAdjustVouchersToStore(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) {
    await idbPutCostAdjustVouchers(null)
  } else {
    const trimmed = list.length > MAX_VOUCHERS ? list.slice(-MAX_VOUCHERS) : list
    await idbPutCostAdjustVouchers(trimmed)
  }
  bumpSync()
}

function nextVoucherCode(list) {
  let max = 0
  for (const v of list) {
    const m = /^GV(\d+)$/i.exec(String(v?.code ?? ''))
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  const n = max + 1
  return `GV${String(n).padStart(3, '0')}`
}

/** Mã phiếu kế tiếp (đọc từ snapshot hiện có, không ghi). */
export function peekNextCostAdjustCode(list) {
  return nextVoucherCode(Array.isArray(list) ? list : [])
}

/**
 * Phiếu tạo tay (Đã hủy, chưa có dòng) — nút "+ Tạo phiếu điều chỉnh giá vốn".
 * @param {CostAdjustVoucher[]} prev
 * @param {string} createdBy
 */
export function appendManualCostAdjustPlaceholder(prev, createdBy) {
  const list = Array.isArray(prev) ? [...prev] : []
  const now = Date.now()
  const voucher = {
    id: `gv_${now}_${Math.random().toString(36).slice(2, 9)}`,
    code: nextVoucherCode(list),
    status: 'da_huy',
    createdAtMs: now,
    adjustedAtMs: null,
    createdBy: String(createdBy || '').trim() || '—',
    lines: [],
  }
  list.push(voucher)
  if (list.length > MAX_VOUCHERS) list.splice(0, list.length - MAX_VOUCHERS)
  return list
}

/**
 * Thêm phiếu hoàn thành mẫu (có thể gọi từ luồng lưu giá vốn Hàng hóa sau này).
 * @param {CostAdjustVoucher[]} prev
 * @param {Omit<CostAdjustLine, never> & { createdBy: string }} line
 */
export function appendCompletedCostAdjustFromGoods(prev, payload) {
  const list = Array.isArray(prev) ? [...prev] : []
  const now = Date.now()
  const oldCost = Number(payload.oldCost) || 0
  const newCost = Number(payload.newCost) || 0
  const voucher = {
    id: `gv_${now}_${Math.random().toString(36).slice(2, 9)}`,
    code: nextVoucherCode(list),
    status: 'hoan_thanh',
    createdAtMs: now,
    adjustedAtMs: now,
    createdBy: String(payload.createdBy || '').trim() || '—',
    lines: [
      {
        variantId: String(payload.variantId || '').trim(),
        productCode: String(payload.productCode || '').trim() || '—',
        productName: String(payload.productName || '').trim() || '—',
        unitLabel: String(payload.unitLabel || '').trim() || '—',
        oldCost,
        newCost,
      },
    ],
  }
  list.push(voucher)
  if (list.length > MAX_VOUCHERS) list.splice(0, list.length - MAX_VOUCHERS)
  return list
}

/**
 * Phiếu hoàn thành từ màn "Tạo phiếu điều chỉnh giá vốn" (nhiều dòng).
 * @param {CostAdjustVoucher[]} prevList
 * @param {{ createdBy: string; lines: CostAdjustLine[]; note?: string; branchLabel?: string; tags?: string }} payload
 */
export function createHoanThanhCostAdjustVoucher(prevList, payload) {
  const list = Array.isArray(prevList) ? prevList : []
  const now = Date.now()
  const lines = Array.isArray(payload.lines) ? payload.lines : []
  const voucher = {
    id: `gv_${now}_${Math.random().toString(36).slice(2, 9)}`,
    code: nextVoucherCode(list),
    status: 'hoan_thanh',
    createdAtMs: now,
    adjustedAtMs: now,
    createdBy: String(payload.createdBy || '').trim() || '—',
    lines,
  }
  if (payload.note != null && String(payload.note).trim() !== '') {
    voucher.note = String(payload.note).trim()
  }
  if (payload.branchLabel != null && String(payload.branchLabel).trim() !== '') {
    voucher.branchLabel = String(payload.branchLabel).trim()
  }
  if (payload.tags != null && String(payload.tags).trim() !== '') {
    voucher.tags = String(payload.tags).trim()
  }
  return voucher
}

/** @param {CostAdjustVoucher[]} prev */
export function appendCostAdjustVoucher(prev, voucher) {
  const list = Array.isArray(prev) ? [...prev] : []
  list.push(voucher)
  if (list.length > MAX_VOUCHERS) list.splice(0, list.length - MAX_VOUCHERS)
  return list
}
