/**
 * Lớp truy cập danh mục sản phẩm — dùng chung POS (Bán hàng) và AdminHub.
 *
 * Lưu trữ bền: IndexedDB (toàn bộ dòng hàng). localStorage chỉ còn dùng để “bump” đồng bộ tab
 * (và đọc legacy khi chưa migrate).
 *
 * Sau này khi có Database/Server: chỉ cần thay nội dung fetchCatalogSnapshotFromPersistentStore()
 * (đọc IndexedDB → gọi fetch API) và saveCatalogSnapshot() (ghi API + optional cache IDB).
 */

import {
  mergeFlatCatalogRowsBySmartUomGroups,
  normalizeBarcodeValue,
  parsePrice,
  parseStockQty,
} from './catalogCsv.js'
import { prepareCatalogForPosSearch } from './catalogSearchSimple.js'
import {
  buildDisplayCatalog,
  normalizeCatalogUnitLabel,
  normalizeGroupRoot,
  parseConversionRatio,
} from './productUnits.js'
import { idbGetCatalogSnapshot, idbPutCatalogSnapshot } from './catalogIndexedDb.js'
import { KIOTNEW_PRODUCT_DB_COLUMNS } from './kiotProductSchema.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export const CATALOG_SNAPSHOT_STORAGE_KEY = 'csv-preview-admin-catalog-snapshot-v1'
/** Tab khác ghi catalog → localStorage chỉ nhận bump nhỏ (snapshot nằm trong IndexedDB). */
export const CATALOG_SYNC_BUMP_KEY = 'csv-preview-catalog-sync-bump-v1'
export const CATALOG_SNAPSHOT_VERSION = 1

/** Bảng flat Kiot (mã hàng PK) — đồng bộ kèm snapshot khi lưu danh mục từ web. */
const PRODUCTS_TABLE = 'products'
/** Mỗi request PostgREST chỉ chứa tối đa N dòng (tránh 500 / giới hạn payload). */
const PRODUCTS_UPSERT_CHUNK = 200

/** Tránh gọi upsert chồng chéo (vòng lặp / double effect). */
let saveCatalogSnapshotInFlight = false
/** Bỏ qua lưu trùng cùng nội dung ngay sau lần trước (giảm 500 / spam). */
let saveCatalogSnapshotLastOkKey = ''

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

function moneyCellString(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return ''
  return String(Math.round(x))
}

/**
 * Một biến thể danh mục POS → một dòng `public.products` (chuỗi, khớp CSV Kiot).
 * @param {object} v
 */
function displayVariantToProductsRow(v) {
  const nowIso = new Date().toISOString()
  const conv =
    v?.conversion != null && Number.isFinite(Number(v.conversion)) && Number(v.conversion) > 0
      ? String(v.conversion)
      : ''
  return {
    ma_hang: String(v?.code ?? '').trim(),
    ma_vach: String(v?.barcode ?? '').trim(),
    ten_hang: String(v?.name ?? '').trim(),
    thuong_hieu: String(v?.brand ?? '').trim(),
    gia_ban: moneyCellString(v?.price),
    gia_von: moneyCellString(v?.cost),
    ton_kho:
      v?.stockQty == null || v.stockQty === ''
        ? ''
        : moneyCellString(v.stockQty),
    kh_dat: '',
    du_kien_het_hang: '',
    ton_nho_nhat: v?.stockNormMin == null ? '' : moneyCellString(v.stockNormMin),
    ton_lon_nhat: v?.stockNormMax == null ? '' : moneyCellString(v.stockNormMax),
    dvt: String(v?.unitLabel ?? '').trim(),
    ma_dvt_co_ban: '',
    quy_doi: conv,
    thuoc_tinh: '',
    ma_hh_lien_quan: String(v?.linkedMasterCode ?? '').trim(),
    trong_luong: String(v?.weightRaw ?? '').trim(),
    dang_kinh_doanh: '',
    duoc_ban_truc_tiep: '',
    gia_si: moneyCellString(v?.wholesalePrice),
    imported_at: nowIso,
  }
}

function flattenDisplayCatalogToVariants(products) {
  if (!Array.isArray(products) || products.length === 0) return []
  return products.flatMap((p) =>
    Array.isArray(p.groupVariants) && p.groupVariants.length > 0 ? p.groupVariants : [p]
  )
}

function catalogSnapshotDedupeKey(products, fileName) {
  const flat = flattenDisplayCatalogToVariants(products || [])
  const sig = flat
    .map((v) =>
      [
        v.id,
        String(v.code ?? ''),
        String(v.name ?? ''),
        String(v.price ?? ''),
        String(v.stockQty ?? ''),
        String(v.cost ?? ''),
      ].join('\t')
    )
    .sort()
    .join('\n')
  return `${String(fileName || '')}\n${sig}`
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {Array} products — display catalog (nhóm + groupVariants)
 */
async function upsertProductRowsFromDisplayCatalog(sb, products) {
  const flat = flattenDisplayCatalogToVariants(products)
  const rows = flat.map(displayVariantToProductsRow).filter((r) => r.ma_hang)
  if (rows.length === 0) return
  const total = rows.length
  const allow = new Set([...KIOTNEW_PRODUCT_DB_COLUMNS, 'imported_at'])
  for (let i = 0; i < rows.length; i += PRODUCTS_UPSERT_CHUNK) {
    const part = rows.slice(i, i + PRODUCTS_UPSERT_CHUNK).map((row) => {
      const o = {}
      for (const k of allow) o[k] = row[k] ?? ''
      return o
    })
    const batchEnd = Math.min(i + part.length, total)
    console.log(
      `[saveProductsToSupabase] Đang lưu ${batchEnd}/${total}… (${part.length} dòng / đợt, ma_hang)`
    )
    const { error } = await sb.from(PRODUCTS_TABLE).upsert(part, { onConflict: 'ma_hang' })
    if (error) throw error
  }
}

/**
 * Upsert toàn bộ biến thể catalog POS → `public.products` (`onConflict: ma_hang`).
 * Chỉ gọi từ hành động người dùng (Lưu, nhập file, khởi tạo…) — không gắn useEffect.
 * @param {Array} products — display catalog (nhóm + groupVariants)
 */
export async function saveProductsToSupabase(products) {
  if (!isSupabaseConfigured()) return
  const sb = getSupabaseClient()
  if (!sb) {
    console.warn('[saveProductsToSupabase] Không tạo được Supabase client.')
    return
  }
  const flat = flattenDisplayCatalogToVariants(products || [])
  const n = flat.filter((v) => String(v?.code ?? '').trim()).length
  console.log(
    `[saveProductsToSupabase] Bắt đầu: ${n} dòng có ma_hang — gửi theo đợt tối đa ${PRODUCTS_UPSERT_CHUNK} dòng/request (không gửi hết một lần).`
  )
  await upsertProductRowsFromDisplayCatalog(sb, products || [])
  console.log('[saveProductsToSupabase] Hoàn tất.')
}

/**
 * Ghi snapshot (Supabase/IDB) rồi đồng bộ bảng `products` — một lần mỗi lần gọi (sự kiện UI).
 */
export async function persistCatalogSnapshotAndProducts(products, fileName) {
  await saveCatalogSnapshot(products, fileName)
  await saveProductsToSupabase(products)
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
 * Đọc toàn bộ `public.products` (phân trang PostgREST).
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 */
async function fetchAllProductRows(sb) {
  const pageSize = 1000
  let from = 0
  const all = []
  for (;;) {
    const to = from + pageSize - 1
    const { data, error } = await sb
      .from(PRODUCTS_TABLE)
      .select('*')
      .order('ma_hang', { ascending: true })
      .range(from, to)
    if (error) throw error
    const chunk = data || []
    all.push(...chunk)
    if (chunk.length < pageSize) break
    from += pageSize
  }
  return all
}

/**
 * Một dòng bảng `products` → dòng phẳng giống sau `rowsToProducts` (catalogCsv), để gom nhóm ĐVT.
 * @param {Record<string, unknown>} row
 * @param {number} rowIndex
 */
function supabaseProductRowToFlatCatalogRow(row, rowIndex) {
  const code = String(row.ma_hang ?? '').trim()
  if (!code) return null
  const importedMs = row.imported_at ? Date.parse(String(row.imported_at)) : NaN
  const baseMs = Number.isFinite(importedMs) ? importedMs : Date.now()
  const barcode = String(normalizeBarcodeValue(row.ma_vach ?? ''))
  const nameRaw = String(row.ten_hang ?? '').trim()
  const name = nameRaw || code
  const convRawStr = String(row.quy_doi ?? '').trim()
  const conversion = parseConversionRatio(convRawStr)
  const stockNormMinRaw = String(row.ton_nho_nhat ?? '').trim()
  const stockNormMaxRaw = String(row.ton_lon_nhat ?? '').trim()
  const stockNormMin = stockNormMinRaw ? parseStockQty(stockNormMinRaw) : null
  const stockNormMax = stockNormMaxRaw ? parseStockQty(stockNormMaxRaw) : null
  return {
    id: `sb-${rowIndex}-${code}`,
    code,
    barcode,
    name,
    nameRaw,
    price: parsePrice(row.gia_ban),
    wholesalePrice: parsePrice(row.gia_si),
    cost: parsePrice(row.gia_von),
    stockQty: parseStockQty(row.ton_kho),
    supplier: '',
    brand: String(row.thuong_hieu ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    linkedMasterCode: String(row.ma_hh_lien_quan ?? '').trim(),
    baseGroupCode: '',
    unitLabel: normalizeCatalogUnitLabel(String(row.dvt ?? '')),
    conversion,
    ...(conversion != null ? { conversionValue: conversion } : {}),
    weightRaw: String(row.trong_luong ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    stockNormMin,
    stockNormMax,
    createdAtMs: baseMs + rowIndex,
    raw: row,
  }
}

/**
 * Khi không có snapshot JSON (hoặc snapshot rỗng) nhưng bảng `products` đã có dữ liệu — dựng lại catalog POS.
 * @returns {Promise<{ products: Array, fileName: string, csvRowCount: number } | null>}
 */
async function fetchDisplayCatalogFromSupabaseProductsTable() {
  const sb = getSupabaseClient()
  if (!sb) return null
  let rows
  try {
    rows = await fetchAllProductRows(sb)
  } catch (e) {
    console.warn('[catalogRepository] Supabase đọc bảng products', e)
    return null
  }
  if (!rows?.length) return null
  const flat = rows.map((r, i) => supabaseProductRowToFlatCatalogRow(r, i)).filter(Boolean)
  if (!flat.length) return null
  const merged = mergeFlatCatalogRowsBySmartUomGroups(flat)
  const display = prepareCatalogForPosSearch(buildDisplayCatalog(merged))
  return {
    products: display,
    fileName: 'supabase-products',
    csvRowCount: countVariantRowsInProducts(display),
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
    const fromProducts = await fetchDisplayCatalogFromSupabaseProductsTable()
    if (fromProducts?.products?.length) return fromProducts
    const fromSnap = await fetchCatalogSnapshotFromSupabase()
    if (fromSnap) return fromSnap
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
  const dedupeKey = catalogSnapshotDedupeKey(products, fileName)
  if (dedupeKey === saveCatalogSnapshotLastOkKey) return
  if (saveCatalogSnapshotInFlight) return
  saveCatalogSnapshotInFlight = true
  try {
    if (isSupabaseConfigured()) {
      await saveCatalogSnapshotToSupabase(products, fileName)
      try {
        localStorage.removeItem(CATALOG_SNAPSHOT_STORAGE_KEY)
      } catch {
        /* ignore */
      }
      bumpCrossTabSync()
      saveCatalogSnapshotLastOkKey = dedupeKey
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
      saveCatalogSnapshotLastOkKey = dedupeKey
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
    saveCatalogSnapshotLastOkKey = dedupeKey
  } catch (e) {
    console.warn('[catalogRepository] saveCatalogSnapshot', e)
  } finally {
    saveCatalogSnapshotInFlight = false
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
  await persistCatalogSnapshotAndProducts(next, fn)
  return {
    products: next,
    fileName: fn,
    csvRowCount: countVariantRowsInProducts(next),
  }
}
