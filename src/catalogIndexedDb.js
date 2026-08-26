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
/** Cache snapshot Supabase kèm `updated_at` server — khác key với SNAPSHOT_KEY (chế độ offline/local). */
const SNAPSHOT_CACHE_KEY = 'catalogSnapshotCacheV1'

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

/**
 * Cache snapshot `catalog_snapshots` (Supabase) kèm `updated_at` server — dùng để bỏ qua tải lại
 * ~600KB khi mở app/tab mới mà cấu trúc danh mục chưa đổi (chỉ so `updated_at`, vài chục byte).
 * @returns {Promise<{ updatedAt: string, snapshot: object } | null>}
 */
export async function idbGetCatalogSnapshotCache() {
  try {
    const db = await openCatalogDb()
    const row = await db.get(STORE, SNAPSHOT_CACHE_KEY)
    return row && typeof row === 'object' ? row : null
  } catch (e) {
    console.warn('[catalogIndexedDb] idbGetCatalogSnapshotCache', e)
    return null
  }
}

/** @param {{ updatedAt: string, snapshot: object } | null} payload — null = xóa */
export async function idbPutCatalogSnapshotCache(payload) {
  try {
    const db = await openCatalogDb()
    if (!payload) {
      await db.delete(STORE, SNAPSHOT_CACHE_KEY)
      return
    }
    await db.put(STORE, payload, SNAPSHOT_CACHE_KEY)
  } catch (e) {
    console.warn('[catalogIndexedDb] idbPutCatalogSnapshotCache', e)
  }
}
