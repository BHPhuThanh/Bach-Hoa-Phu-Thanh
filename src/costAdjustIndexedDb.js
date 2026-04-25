/**
 * Phiếu điều chỉnh giá vốn — lưu IndexedDB (bền hơn localStorage khi danh sách dài).
 */

import { openDB } from 'idb'

const DB_NAME = 'csv-preview-cost-adjust-idb-v1'
const STORE = 'kv'
const VOUCHERS_KEY = 'costAdjustVouchersV1'

function openDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    },
  })
}

/** @returns {Promise<unknown[] | null>} */
export async function idbGetCostAdjustVouchers() {
  try {
    const db = await openDb()
    const row = await db.get(STORE, VOUCHERS_KEY)
    return Array.isArray(row) ? row : null
  } catch (e) {
    console.warn('[costAdjustIndexedDb] get', e)
    return null
  }
}

/** @param {unknown[] | null} rows */
export async function idbPutCostAdjustVouchers(rows) {
  const db = await openDb()
  if (!rows || rows.length === 0) {
    await db.delete(STORE, VOUCHERS_KEY)
    return
  }
  await db.put(STORE, rows, VOUCHERS_KEY)
}
