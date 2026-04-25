/**
 * Lưu snapshot danh mục (hàng chục nghìn dòng) vào IndexedDB — không giới hạn ~5MB như localStorage.
 *
 * Sau này khi có Database/Server, phần "lấy dữ liệu" trong catalogRepository chỉ cần thay
 * đọc IndexedDB bằng lệnh gọi API (fetch) từ server; file này có thể giữ làm cache offline hoặc bỏ.
 */

import { openDB } from 'idb'

const DB_NAME = 'csv-preview-catalog-idb-v1'
const STORE = 'kv'
const SNAPSHOT_KEY = 'catalogSnapshotV1'

function openCatalogDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    },
  })
}

/** @returns {Promise<object | null>} payload { v, fileName, savedAt, products } hoặc null */
export async function idbGetCatalogSnapshot() {
  try {
    const db = await openCatalogDb()
    const row = await db.get(STORE, SNAPSHOT_KEY)
    return row && typeof row === 'object' ? row : null
  } catch (e) {
    console.warn('[catalogIndexedDb] idbGetCatalogSnapshot', e)
    return null
  }
}

/** @param {object | null} payload — null = xóa */
export async function idbPutCatalogSnapshot(payload) {
  const db = await openCatalogDb()
  if (!payload) {
    await db.delete(STORE, SNAPSHOT_KEY)
    return
  }
  await db.put(STORE, payload, SNAPSHOT_KEY)
}
