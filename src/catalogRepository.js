/**
 * Lớp truy cập danh mục sản phẩm — dùng chung POS (Bán hàng) và AdminHub.
 *
 * Lưu trữ bền: IndexedDB (toàn bộ dòng hàng). localStorage chỉ còn dùng để “bump” đồng bộ tab
 * (và đọc legacy khi chưa migrate).
 *
 * Sau này khi có Database/Server: chỉ cần thay nội dung fetchCatalogSnapshotFromPersistentStore()
 * (đọc IndexedDB → gọi fetch API) và saveCatalogSnapshot() (ghi API + optional cache IDB).
 */

import { mergeFlatCatalogRowsBySmartUomGroups } from './catalogCsv.js'
import { prepareCatalogForPosSearch } from './catalogSearchSimple.js'
import { buildDisplayCatalog, normalizeGroupRoot } from './productUnits.js'
import { idbGetCatalogSnapshot, idbPutCatalogSnapshot } from './catalogIndexedDb.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export const CATALOG_SNAPSHOT_STORAGE_KEY = 'csv-preview-admin-catalog-snapshot-v1'
/** Tab khác ghi catalog → localStorage chỉ nhận bump nhỏ (snapshot nằm trong IndexedDB). */
export const CATALOG_SYNC_BUMP_KEY = 'csv-preview-catalog-sync-bump-v1'
export const CATALOG_SNAPSHOT_VERSION = 1

/** Bảng Supabase lưu snapshot JSON cho POS (mỗi dòng = một id, thường dùng `catalog`). */
export const CATALOG_SNAPSHOT_TABLE = 'catalog_snapshots'
/** Một dòng trong bảng snapshot chứa toàn bộ JSON danh mục. */
export const CATALOG_SUPABASE_ROW_ID = 'catalog'

/** Bật khi có endpoint (ví dụ VITE_CATALOG_API_URL). */
export function isCatalogRemoteEnabled() {
  const u = typeof import.meta !== 'undefined' && import.meta.env?.VITE_CATALOG_API_URL
  return typeof u === 'string' && u.trim().length > 0
}

export function countVariantRowsInProducts(products) {
  let n = 0
  for (const p of products || []) {
    const vars = p.groupVariants
    n += Array.isArray(vars) && vars.length > 0 ? vars.length : 1
  }
  return n
}

function bumpCrossTabSync() {
  try {
    localStorage.setItem(CATALOG_SYNC_BUMP_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/**
 * Đọc legacy từ localStorage (bản đồng bộ cũ, có thể quá lớn — sẽ migrate sang IndexedDB).
 * @returns {{ products: Array, fileName: string, csvRowCount: number } | null}
 */
function readLegacyLocalStorageCatalogSnapshot() {
  try {
    const raw = localStorage.getItem(CATALOG_SNAPSHOT_STORAGE_KEY)
    if (!raw) return null
    const j = JSON.parse(raw)
    if (!j || j.v !== CATALOG_SNAPSHOT_VERSION || !Array.isArray(j.products) || j.products.length === 0) {
      return null
    }
    const products = j.products
    const fileName = String(j.fileName || '')
    return {
      products,
      fileName,
      csvRowCount: countVariantRowsInProducts(products),
    }
  } catch {
    return null
  }
}

function snapshotFromPayload(j) {
  if (!j || j.v !== CATALOG_SNAPSHOT_VERSION || !Array.isArray(j.products) || j.products.length === 0) {
    return null
  }
  const products = j.products
  const fileName = String(j.fileName || '')
  return {
    products,
    fileName,
    csvRowCount: countVariantRowsInProducts(products),
  }
}

/**
 * @returns {Promise<{ products: Array, fileName: string, csvRowCount: number } | null>}
 */
async function fetchCatalogSnapshotFromSupabase() {
  const sb = getSupabaseClient()
  if (!sb) return null
  try {
    const { data, error } = await sb
      .from(CATALOG_SNAPSHOT_TABLE)
      .select('snapshot')
      .eq('id', CATALOG_SUPABASE_ROW_ID)
      .maybeSingle()
    if (error) throw error
    const raw = data?.snapshot
    if (raw == null) return null
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    return snapshotFromPayload(j)
  } catch (e) {
    console.warn('[catalogRepository] Supabase đọc catalog', e)
    return null
  }
}

/**
 * @param {Array} products
 * @param {string} fileName
 */
async function saveCatalogSnapshotToSupabase(products, fileName) {
  const sb = getSupabaseClient()
  if (!sb) return
  const now = new Date().toISOString()
  const snapshot =
    !products?.length
      ? {
          v: CATALOG_SNAPSHOT_VERSION,
          fileName: String(fileName || ''),
          savedAt: now,
          products: [],
        }
      : {
          v: CATALOG_SNAPSHOT_VERSION,
          fileName: String(fileName || ''),
          savedAt: now,
          products,
        }
  const { error } = await sb.from(CATALOG_SNAPSHOT_TABLE).upsert(
    {
      id: CATALOG_SUPABASE_ROW_ID,
      snapshot,
      updated_at: now,
    },
    { onConflict: 'id' }
  )
  if (error) throw error
}

/**
 * Lấy snapshot từ kho lưu bền (IndexedDB → migrate legacy localStorage).
 * Sau này thay phần đọc IndexedDB bằng fetch('/api/catalog') rồi vẫn trả cùng hình dạng object.
 *
 * @returns {Promise<{ products: Array, fileName: string, csvRowCount: number } | null>}
 */
export async function fetchCatalogSnapshotFromPersistentStore() {
  if (isSupabaseConfigured()) {
    const fromSb = await fetchCatalogSnapshotFromSupabase()
    if (fromSb) return fromSb
    return null
  }
  if (isCatalogRemoteEnabled()) {
    try {
      const base = String(import.meta.env.VITE_CATALOG_API_URL).replace(/\/$/, '')
      const res = await fetch(`${base}/products`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const j = await res.json()
      const products = Array.isArray(j.products) ? j.products : []
      const fileName = String(j.fileName || j.sourceFileName || '')
      if (products.length === 0) return null
      return {
        products,
        fileName,
        csvRowCount: countVariantRowsInProducts(products),
      }
    } catch (e) {
      console.warn('[catalogRepository] API catalog lỗi, fallback IndexedDB/local', e)
    }
  }

  const rawIdb = await idbGetCatalogSnapshot()
  const fromIdb = snapshotFromPayload(rawIdb)
  if (fromIdb) return fromIdb

  const legacy = readLegacyLocalStorageCatalogSnapshot()
  if (legacy?.products?.length) {
    try {
      await idbPutCatalogSnapshot({
        v: CATALOG_SNAPSHOT_VERSION,
        fileName: legacy.fileName,
        savedAt: new Date().toISOString(),
        products: legacy.products,
      })
      try {
        localStorage.removeItem(CATALOG_SNAPSHOT_STORAGE_KEY)
      } catch {
        /* ignore */
      }
      bumpCrossTabSync()
    } catch (e) {
      console.warn('[catalogRepository] migrate legacy → IndexedDB', e)
    }
    return legacy
  }

  return null
}

/**
 * Đọc đồng bộ (chỉ legacy localStorage) — dùng khi khởi tạo state React trước khi IndexedDB async.
 * Ưu tiên gọi fetchProducts() / fetchCatalogSnapshotFromPersistentStore() để có dữ liệu đầy đủ.
 */
export function readCatalogSnapshotSync() {
  return readLegacyLocalStorageCatalogSnapshot()
}

/**
 * Lấy danh mục (API nếu bật, không thì IndexedDB + migrate).
 * @returns {Promise<{ products: Array, fileName: string, csvRowCount: number } | null>}
 */
export async function fetchProducts() {
  return fetchCatalogSnapshotFromPersistentStore()
}

/**
 * Ghi snapshot: IndexedDB (+ API nếu bật). Không ghi JSON lớn vào localStorage.
 */
export async function saveCatalogSnapshot(products, fileName) {
  try {
    if (isSupabaseConfigured()) {
      await saveCatalogSnapshotToSupabase(products, fileName)
      try {
        localStorage.removeItem(CATALOG_SNAPSHOT_STORAGE_KEY)
      } catch {
        /* ignore */
      }
      bumpCrossTabSync()
      return
    }
    if (!products?.length) {
      await idbPutCatalogSnapshot(null)
      try {
        localStorage.removeItem(CATALOG_SNAPSHOT_STORAGE_KEY)
      } catch {
        /* ignore */
      }
      bumpCrossTabSync()
      return
    }
    const payload = {
      v: CATALOG_SNAPSHOT_VERSION,
      fileName: String(fileName || ''),
      savedAt: new Date().toISOString(),
      products,
    }
    await idbPutCatalogSnapshot(payload)
    try {
      localStorage.removeItem(CATALOG_SNAPSHOT_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    bumpCrossTabSync()
    if (isCatalogRemoteEnabled()) {
      try {
        const base = String(import.meta.env.VITE_CATALOG_API_URL).replace(/\/$/, '')
        await fetch(`${base}/products`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch (e) {
        console.warn('[catalogRepository] saveCatalogSnapshot remote (bỏ qua)', e)
      }
    }
  } catch (e) {
    console.warn('[catalogRepository] saveCatalogSnapshot', e)
  }
}

/**
 * Áp dụng thay đổi thuần hàm (không I/O).
 * @param {Array} products — mảng display catalog
 * @param {object} productData
 * @param {'patch_variant'|'replace_group'|'remove_variants'|'set_catalog'|'append_flat_variants'} productData.type
 */
export function applyProductDataToCatalog(products, productData) {
  if (!Array.isArray(products) || !productData || typeof productData !== 'object') return products
  const { type } = productData
  if (type === 'append_flat_variants') {
    const newRows = productData.variants
    if (!Array.isArray(newRows) || newRows.length === 0) return products
    const flat = products.flatMap((p) => p.groupVariants || [p])
    const merged = mergeFlatCatalogRowsBySmartUomGroups([...flat, ...newRows])
    return prepareCatalogForPosSearch(buildDisplayCatalog(merged))
  }
  if (type === 'set_catalog') {
    const next = productData.products
    return Array.isArray(next) && next.length > 0 ? prepareCatalogForPosSearch(next) : []
  }
  if (type === 'remove_variants') {
    const ids = productData.variantIds
    if (!Array.isArray(ids) || ids.length === 0) return products
    const idSet = new Set(ids)
    const flat = products.flatMap((p) => p.groupVariants || [p]).filter((v) => !idSet.has(v.id))
    if (flat.length === 0) return []
    return prepareCatalogForPosSearch(buildDisplayCatalog(flat))
  }
  if (type === 'replace_group') {
    const { anchorVariantId, replacements } = productData
    if (anchorVariantId == null || !Array.isArray(replacements) || replacements.length === 0) {
      return products
    }
    const flat = products.flatMap((p) => p.groupVariants || [p])
    const target = flat.find((v) => v.id === anchorVariantId)
    if (!target) return products
    const root = normalizeGroupRoot(target.code, target.linkedMasterCode)
    const kept = flat.filter((v) => normalizeGroupRoot(v.code, v.linkedMasterCode) !== root)
    const merged = [...kept, ...replacements]
    return prepareCatalogForPosSearch(buildDisplayCatalog(merged))
  }
  if (type === 'patch_variant') {
    const { variantId, patch } = productData
    if (variantId == null || !patch || typeof patch !== 'object') return products
    const flat = products.flatMap((p) => p.groupVariants || [p])
    const target = flat.find((v) => v.id === variantId)
    if (!target) return products
    const rootBefore = normalizeGroupRoot(target.code, target.linkedMasterCode)
    const syncName = Object.prototype.hasOwnProperty.call(patch, 'name')
    const nameNext = syncName
      ? String(patch.name ?? '')
          .replace(/\u00A0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : null
    const next = flat.map((v) => {
      if (v.id === variantId) return { ...v, ...patch }
      if (syncName && normalizeGroupRoot(v.code, v.linkedMasterCode) === rootBefore) {
        return { ...v, name: nameNext }
      }
      return v
    })
    const changed = next.some((v, i) => v !== flat[i])
    if (!changed) return products
    return prepareCatalogForPosSearch(buildDisplayCatalog(next))
  }
  return products
}

/**
 * Cập nhật bền vững + trả về snapshot mới (để đồng bộ state React).
 * @param {Array} currentProducts
 * @param {string} fileName
 * @param {object} productData — xem {@link applyProductDataToCatalog}
 * @returns {Promise<{ products: Array, fileName: string, csvRowCount: number }>}
 */
export async function updateProduct(currentProducts, fileName, productData) {
  const fn =
    productData && Object.prototype.hasOwnProperty.call(productData, 'fileName')
      ? String(productData.fileName ?? '')
      : String(fileName || '')
  const next = applyProductDataToCatalog(currentProducts, productData)
  await saveCatalogSnapshot(next, fn)
  return {
    products: next,
    fileName: fn,
    csvRowCount: countVariantRowsInProducts(next),
  }
}
