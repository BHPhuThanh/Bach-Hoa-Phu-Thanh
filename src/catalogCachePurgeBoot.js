/**
 * Mỗi lần load trang: xóa cache catalog trên trình duyệt (localStorage legacy + IndexedDB)
 * để không giữ snapshot cũ sai cột dvt / quy_doi.
 */
import { CATALOG_SNAPSHOT_STORAGE_KEY, CATALOG_SYNC_BUMP_KEY } from './catalogRepository.js'
import { idbPutCatalogSnapshot } from './catalogIndexedDb.js'

export async function clearCatalogBrowserCacheOnBoot() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(CATALOG_SNAPSHOT_STORAGE_KEY)
    localStorage.removeItem(CATALOG_SYNC_BUMP_KEY)
  } catch {
    /* ignore */
  }
  try {
    await idbPutCatalogSnapshot(null)
  } catch {
    /* ignore */
  }
}
