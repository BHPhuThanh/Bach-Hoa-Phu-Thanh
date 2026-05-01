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
import { CATALOG_PRODUCT_DB_COLUMNS, PRODUCT_PK_COLUMN } from './kiotProductSchema.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export const CATALOG_SNAPSHOT_STORAGE_KEY = 'csv-preview-admin-catalog-snapshot-v1'
/** Tab khác ghi catalog → localStorage chỉ nhận bump nhỏ (snapshot nằm trong IndexedDB). */
export const CATALOG_SYNC_BUMP_KEY = 'csv-preview-catalog-sync-bump-v1'
export const CATALOG_SNAPSHOT_VERSION = 1
const DEFAULT_CATALOG_FILE_NAME = 'bhphuthanh.csv'

/** Bảng flat Kiot (mã hàng PK) — đồng bộ kèm snapshot khi lưu danh mục từ web. */
const PRODUCTS_TABLE = 'products'
/** Mỗi request PostgREST chỉ chứa tối đa N dòng (tránh 500 / giới hạn payload). */
const PRODUCTS_UPSERT_CHUNK = 200

/**
 * Cột tiền/tồn/khối lượng… — dọn chuỗi số Kiot: bỏ `.` phân nghìn, `,` → `.` thập phân, rồi chuẩn hóa thành chữ số.
 * Không áp dụng cho mã vạch, tên hàng, ngày dự kiến…
 */
const PRODUCT_AMOUNT_STRING_COLUMNS = new Set([
  'gia_ban',
  'gia_von',
  'ton_kho',
  'ton_nho_nhat',
  'ton_lon_nhat',
  'quy_doi',
  'trong_luong',
  'gia_si',
])

/** Tránh gọi upsert chồng chéo (vòng lặp / double effect). */
let saveCatalogSnapshotInFlight = false
/** Bỏ qua lưu trùng cùng nội dung ngay sau lần trước (giảm 500 / spam). */
let saveCatalogSnapshotLastOkKey = ''

/** Bảng Supabase lưu snapshot JSON cho POS (mỗi dòng = một id, thường dùng `catalog`). */
export const CATALOG_SNAPSHOT_TABLE = 'catalog_snapshots'
/** Một dòng trong bảng snapshot chứa toàn bộ JSON danh mục. */
export const CATALOG_SUPABASE_ROW_ID = 'catalog'

function normalizeCatalogFileName(fileName) {
  const s = String(fileName || '').trim()
  return s || DEFAULT_CATALOG_FILE_NAME
}

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

/** Chuỗi text cho cột `text` trên Supabase (không để undefined). */
function dbTextCell(raw) {
  const s = String(raw ?? '')
    .replace(/\u00A0/g, ' ')
    .trim()
  return s
}

/**
 * Dọn ô số Kiot (ví dụ `60.000,0`): bỏ mọi `.`, đổi `,` thành `.`, rồi chuỗi số thập phân chuẩn (không còn dấu phẩy).
 * @returns {string} rỗng nếu không parse được.
 */
function cleanKiotAmountToDecimalString(raw) {
  let s = String(raw ?? '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/\s/g, '')
    .replace(/đ/gi, '')
  if (!s) return ''
  const neg = /^-/.test(s)
  s = s.replace(/^-/, '')
  s = s.replace(/[^\d.,]/g, '')
  if (!s) return ''
  s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n)) return ''
  return String(neg ? -n : n)
}

function formatSupabaseWriteError(err) {
  if (!err || typeof err !== 'object') return String(err)
  return {
    message: err.message,
    details: err.details,
    hint: err.hint,
    code: err.code,
  }
}

/** Thông báo ngắn cho `alert` (PostgREST, Error, chuỗi, hoặc unknown). */
export function describeCatalogPersistError(err) {
  if (err == null) return 'Lỗi không xác định khi đồng bộ Supabase.'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || String(err)
  if (typeof err === 'object' && err.message != null) {
    const x = formatSupabaseWriteError(err)
    const parts = [x.message, x.details, x.hint, x.code && `(${x.code})`].filter(Boolean)
    return parts.length ? parts.join(' — ') : JSON.stringify(err)
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function notifySupabasePersistFailure(error) {
  console.error('LỖI SUPABASE THẬT SỰ:', error)
  const msg = describeCatalogPersistError(error)
  try {
    if (typeof globalThis.alert === 'function') globalThis.alert(msg)
  } catch {
    /* ignore */
  }
}

/**
 * Một biến thể POS → dòng logic trước khi {@link finalizeProductRowForSupabase} ép toàn bộ thành chuỗi gửi API.
 * @param {object} v
 */
function displayVariantToProductsRow(v) {
  const conv =
    v?.conversion != null && Number.isFinite(Number(v.conversion)) && Number(v.conversion) > 0
      ? String(v.conversion)
      : ''
  const maHang = dbTextCell(v?.code)
  const dvtRaw = dbTextCell(v?.unitLabel)
  return {
    ma_hang: maHang,
    ma_vach: dbTextCell(v?.barcode),
    ten_hang: dbTextCell(v?.name),
    thuong_hieu: dbTextCell(v?.brand),
    gia_ban: v?.price,
    gia_von: v?.cost,
    ton_kho: v?.stockQty,
    ton_nho_nhat: v?.stockNormMin,
    ton_lon_nhat: v?.stockNormMax,
    dvt: dvtRaw || 'Cái',
    ma_dvt_co_ban: '',
    quy_doi: conv,
    ma_hh_lien_quan: dbTextCell(v?.linkedMasterCode),
    trong_luong: v?.weightRaw,
    gia_si: v?.wholesalePrice,
  }
}

/**
 * Giữ đúng cột bảng SQL; mọi giá trị là `String` (PostgREST / cột `text`).
 * Cột trong {@link PRODUCT_AMOUNT_STRING_COLUMNS}: dọn dấu chấm/phẩy kiểu Kiot rồi `String`.
 * @param {Record<string, unknown>} row
 * @param {Set<string>} allow
 */
function finalizeProductRowForSupabase(row, allow) {
  const o = {}
  for (const k of allow) {
    let raw = row[k]
    if (raw === undefined || raw === null) raw = ''
    let out
    if (PRODUCT_AMOUNT_STRING_COLUMNS.has(k)) {
      out = cleanKiotAmountToDecimalString(raw)
    } else {
      out = dbTextCell(raw)
    }
    o[k] = String(out)
  }
  return o
}

/** Trùng khóa `Mã hàng` trong một request làm lỗi upsert — giữ bản cuối. */
function dedupeRowsByProductCode(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = String(r[PRODUCT_PK_COLUMN] ?? '').trim()
    if (!key) continue
    map.set(key, r)
  }
  return [...map.values()]
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
 * Upsert một đợt; nếu cả đợt lỗi thì thử từng dòng — bỏ qua dòng lỗi, các dòng khác vẫn lưu.
 * PostgREST không có cờ “bỏ qua một dòng” trên bulk; xử lý phía client.
 * @returns {{ written: number, skipped: number }}
 */
async function upsertProductChunkResilient(sb, part) {
  const { error } = await sb.from(PRODUCTS_TABLE).upsert(part, { onConflict: PRODUCT_PK_COLUMN })
  if (!error) return { written: part.length, skipped: 0 }
  if (part.length <= 1) {
    const row = part[0]
    console.warn('[saveProductsToSupabase] Bỏ qua 1 dòng lỗi', {
      [PRODUCT_PK_COLUMN]: row?.[PRODUCT_PK_COLUMN],
      ten_hang: row?.ten_hang,
      supabase: formatSupabaseWriteError(error),
    })
    return { written: 0, skipped: 1 }
  }
  console.warn(
    `[saveProductsToSupabase] Đợt ${part.length} dòng lỗi — thử upsert từng dòng (${PRODUCT_PK_COLUMN} "${part[0]?.[PRODUCT_PK_COLUMN]}" … "${part[part.length - 1]?.[PRODUCT_PK_COLUMN]}")`,
    formatSupabaseWriteError(error)
  )
  let written = 0
  let skipped = 0
  for (const row of part) {
    const r = await sb.from(PRODUCTS_TABLE).upsert([row], { onConflict: PRODUCT_PK_COLUMN })
    if (r.error) {
      skipped += 1
      console.warn(
        '[saveProductsToSupabase] Bỏ qua dòng',
        String(row?.[PRODUCT_PK_COLUMN] ?? ''),
        formatSupabaseWriteError(r.error)
      )
    } else {
      written += 1
    }
  }
  return { written, skipped }
}

/**
 * @returns {Promise<{ written: number, skippedUpsert: number }>}
 */
/** Khớp tên cột Supabase (Unicode) — không gửi `imported_at` nếu bảng không có cột đó. */
const PRODUCT_ROW_KEYS_FOR_DB = new Set(CATALOG_PRODUCT_DB_COLUMNS)

/**
 * Upsert các dòng đã map {@link displayVariantToProductsRow} (chunk + dedupe theo Mã hàng).
 * @returns {{ written: number, skippedUpsert: number }}
 */
async function upsertRawProductRows(sb, rawRows) {
  const withCode = rawRows.filter((r) => String(r[PRODUCT_PK_COLUMN] ?? '').trim().length > 0)
  const skippedNoCode = rawRows.length - withCode.length
  if (skippedNoCode > 0) {
    console.warn(
      `[saveProductsToSupabase] Đã loại ${skippedNoCode} dòng không có "${PRODUCT_PK_COLUMN}" (thiếu hoặc rỗng), không gửi lên Supabase.`
    )
  }
  const deduped = dedupeRowsByProductCode(withCode)
  if (deduped.length < withCode.length) {
    console.warn(
      `[saveProductsToSupabase] Gộp trùng ${PRODUCT_PK_COLUMN}: ${withCode.length} → ${deduped.length} dòng (giữ bản sau cùng).`
    )
  }
  const allow = new Set(CATALOG_PRODUCT_DB_COLUMNS)
  const rows = deduped.map((row) => finalizeProductRowForSupabase(row, allow))
  if (rows.length === 0) return { written: 0, skippedUpsert: 0 }
  const total = rows.length
  let written = 0
  let skippedUpsert = 0
  for (let i = 0; i < rows.length; i += PRODUCTS_UPSERT_CHUNK) {
    const part = rows.slice(i, i + PRODUCTS_UPSERT_CHUNK)
    const batchEnd = Math.min(i + part.length, total)
    console.log(
      `[saveProductsToSupabase] Đang lưu ${batchEnd}/${total}… (${part.length} dòng / đợt, ${PRODUCT_PK_COLUMN})`
    )
    const r = await upsertProductChunkResilient(sb, part)
    written += r.written
    skippedUpsert += r.skipped
  }
  if (skippedUpsert > 0) {
    console.warn(
      `[saveProductsToSupabase] Đồng bộ xong: đã ghi ${written}/${total} dòng; ${skippedUpsert} dòng bị bỏ qua do lỗi API.`
    )
  }
  return { written, skippedUpsert }
}

async function upsertProductRowsFromDisplayCatalog(sb, products) {
  const flat = flattenDisplayCatalogToVariants(products || [])
  const rawRows = flat.map(displayVariantToProductsRow)
  return upsertRawProductRows(sb, rawRows)
}

/**
 * Upsert toàn bộ biến thể catalog POS → `public.products` (`onConflict`: {@link PRODUCT_PK_COLUMN}).
 * Chỉ gọi từ hành động người dùng (Lưu, nhập file, khởi tạo…) — không gắn useEffect.
 * @param {Array} products — display catalog (nhóm + groupVariants)
 * @returns {Promise<{ ok: boolean, skipped?: boolean, written?: number, skippedUpsert?: number, error?: unknown }>}
 */
export async function saveProductsToSupabase(products) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb) {
    const err = new Error(
      '[saveProductsToSupabase] Không tạo được Supabase client (thiếu env hoặc cấu hình).'
    )
    notifySupabasePersistFailure(err)
    return { ok: false, error: err }
  }
  const flat = flattenDisplayCatalogToVariants(products || [])
  const rawRows = flat.map(displayVariantToProductsRow)
  const withCode = rawRows.filter((r) => String(r[PRODUCT_PK_COLUMN] ?? '').trim().length > 0)
  const toSend = dedupeRowsByProductCode(withCode)
  try {
    if (flat.length > 0 && toSend.length === 0) {
      const err = new Error(
        'Không có dòng nào có «Mã hàng» hợp lệ để gửi lên Supabase (`products.ma_hang`).'
      )
      notifySupabasePersistFailure(err)
      return { ok: false, error: err }
    }
    console.log(
      `[saveProductsToSupabase] Bắt đầu: ${toSend.length} dòng upsert (${PRODUCT_PK_COLUMN} hợp lệ, đã gộp trùng), ` +
        `${flat.length} biến thể sau flatten — tối đa ${PRODUCTS_UPSERT_CHUNK} dòng/request; payload toàn chuỗi; đợt lỗi sẽ thử từng dòng.`
    )
    const { written, skippedUpsert } = await upsertProductRowsFromDisplayCatalog(sb, products || [])
    if (toSend.length > 0 && written === 0) {
      const err = new Error(
        `Upsert bảng «products»: không ghi được dòng nào (${skippedUpsert}/${toSend.length} bị bỏ qua). Kiểm tra RLS, quyền ghi API, và log phía Supabase.`
      )
      notifySupabasePersistFailure(err)
      return { ok: false, error: err, written, skippedUpsert }
    }
    console.log('[saveProductsToSupabase] Hoàn tất.', { written, skippedUpsert })
    return { ok: true, written, skippedUpsert }
  } catch (error) {
    notifySupabasePersistFailure(error)
    return { ok: false, error }
  }
}

/**
 * Chỉ upsert các biến thể vừa thêm/sửa — không gửi lại cả danh mục (thousands rows).
 * @param {Array<object>} flatDisplayVariants — dòng phẳng POS (giống phần tử trong groupVariants).
 * @returns {Promise<{ ok: boolean, skipped?: boolean, written?: number, skippedUpsert?: number, error?: unknown }>}
 */
export async function saveProductsToSupabaseUpsertOnly(flatDisplayVariants) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb || !flatDisplayVariants?.length) return { ok: true }
  const rawRows = flatDisplayVariants.map(displayVariantToProductsRow)
  const eligible = dedupeRowsByProductCode(
    rawRows.filter((r) => String(r[PRODUCT_PK_COLUMN] ?? '').trim().length > 0)
  )
  try {
    if (eligible.length === 0) {
      const err = new Error(
        'Upsert chỉ các biến thể được chọn: không có «Mã hàng» hợp lệ trong nhóm upsert.'
      )
      notifySupabasePersistFailure(err)
      return { ok: false, error: err }
    }
    console.log(
      `[saveProductsToSupabase] Chỉ upsert ${rawRows.length} dòng (incremental), không đồng bộ toàn bộ catalog.`
    )
    const { written, skippedUpsert } = await upsertRawProductRows(sb, rawRows)
    if (written === 0) {
      const err = new Error(
        `Upsert bảng «products»: không ghi được dòng nào (${skippedUpsert}/${eligible.length} bị bỏ qua). Kiểm tra RLS, quyền ghi API, và log phía Supabase.`
      )
      notifySupabasePersistFailure(err)
      return { ok: false, error: err, written, skippedUpsert }
    }
    return { ok: true, written, skippedUpsert }
  } catch (error) {
    notifySupabasePersistFailure(error)
    return { ok: false, error }
  }
}

/**
 * Ghi snapshot (Supabase/IDB) rồi đồng bộ bảng `products`.
 * Khi có Supabase: `ok` chỉ là `true` nếu bước upsert `products` thành công — tránh đọc lại từ server rồi đè UI bằng dữ liệu cũ (snapshot có thể mới nhưng `products` đọc ưu tiên không khớp).
 * @param {object} [options]
 * @param {Array<object>} [options.upsertOnlyVariants] — nếu có: chỉ upsert các biến thể này lên `products`, vẫn ghi snapshot đầy đủ `products`.
 * @returns {Promise<{ ok: boolean, error?: unknown, snapshotSaved?: boolean }>}
 */
export async function persistCatalogSnapshotAndProducts(products, fileName, options) {
  await saveCatalogSnapshot(products, fileName)
  if (!isSupabaseConfigured()) return { ok: true }
  if (options?.upsertOnlyVariants?.length) {
    const r = await saveProductsToSupabaseUpsertOnly(options.upsertOnlyVariants)
    return r.ok ? { ok: true, snapshotSaved: true } : { ok: false, error: r.error, snapshotSaved: true }
  }
  const r = await saveProductsToSupabase(products)
  return r.ok ? { ok: true, snapshotSaved: true } : { ok: false, error: r.error, snapshotSaved: true }
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
    const products = normalizeDisplayCatalogNumericFields(j.products)
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
  const products = normalizeDisplayCatalogNumericFields(j.products)
  const fileName = String(j.fileName || '')
  return {
    products,
    fileName,
    csvRowCount: countVariantRowsInProducts(products),
  }
}

function normalizeDisplayVariantNumbers(v) {
  if (!v || typeof v !== 'object') return v
  return {
    ...v,
    price: parsePrice(v.price),
    wholesalePrice: parsePrice(v.wholesalePrice),
    cost: parsePrice(v.cost),
    stockQty: parseStockQty(v.stockQty),
    stockNormMin: v.stockNormMin == null || v.stockNormMin === '' ? null : parseStockQty(v.stockNormMin),
    stockNormMax: v.stockNormMax == null || v.stockNormMax === '' ? null : parseStockQty(v.stockNormMax),
    conversion:
      v.conversion == null || v.conversion === '' ? null : parseConversionRatio(String(v.conversion)),
    conversionValue:
      v.conversionValue == null || v.conversionValue === ''
        ? null
        : parseConversionRatio(String(v.conversionValue)),
  }
}

function normalizeDisplayCatalogNumericFields(products) {
  if (!Array.isArray(products) || products.length === 0) return []
  return products.map((p) => {
    if (Array.isArray(p.groupVariants) && p.groupVariants.length > 0) {
      return {
        ...normalizeDisplayVariantNumbers(p),
        groupVariants: p.groupVariants.map(normalizeDisplayVariantNumbers),
      }
    }
    return normalizeDisplayVariantNumbers(p)
  })
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
      .order(PRODUCT_PK_COLUMN, { ascending: true })
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
 * Một dòng bảng `products` → dòng phẳng giống sau `rowsToProducts` (catalogCsv), để gom nhóm ĐƠN VỊ TÍNH.
 * @param {Record<string, unknown>} row
 * @param {number} rowIndex
 */
function supabaseProductRowToFlatCatalogRow(row, rowIndex) {
  const code = String(row[PRODUCT_PK_COLUMN] ?? '').trim()
  if (!code) return null
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
    createdAtMs: Date.now() + rowIndex,
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
  const display = normalizeDisplayCatalogNumericFields(
    prepareCatalogForPosSearch(buildDisplayCatalog(merged))
  )
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
  const normalizedFileName = normalizeCatalogFileName(fileName)
  const snapshot =
    !products?.length
      ? {
          v: CATALOG_SNAPSHOT_VERSION,
          fileName: normalizedFileName,
          savedAt: now,
          products: [],
        }
      : {
          v: CATALOG_SNAPSHOT_VERSION,
          fileName: normalizedFileName,
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
 * Nguồn danh mục.
 * — Khi cấu hình Supabase: chỉ đọc từ bảng `products` hoặc `catalog_snapshots` (không đọc file CSV trong app, không fallback IndexedDB).
 * — Không có Supabase: có thể dùng API tùy chọn hoặc IndexedDB/local (dev / nhập tay).
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
      const products = normalizeDisplayCatalogNumericFields(Array.isArray(j.products) ? j.products : [])
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
 * Tải lại danh mục từ nguồn bền (Supabase `products` / snapshot, …) — dùng sau insert/update như mutate/revalidate.
 * @returns {Promise<{ products: Array, fileName: string, csvRowCount: number } | null>}
 */
export async function revalidateCatalogFromStore() {
  return fetchCatalogSnapshotFromPersistentStore()
}

/**
 * Ghi snapshot: IndexedDB (+ API nếu bật). Không ghi JSON lớn vào localStorage.
 */
export async function saveCatalogSnapshot(products, fileName) {
  const normalizedFileName = normalizeCatalogFileName(fileName)
  const dedupeKey = catalogSnapshotDedupeKey(products, normalizedFileName)
  if (dedupeKey === saveCatalogSnapshotLastOkKey) return
  if (saveCatalogSnapshotInFlight) return
  saveCatalogSnapshotInFlight = true
  try {
    if (isSupabaseConfigured()) {
      await saveCatalogSnapshotToSupabase(products, normalizedFileName)
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
      fileName: normalizedFileName,
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
 * @returns {Promise<{ products: Array, fileName: string, csvRowCount: number, persistOk: boolean, persistError?: unknown }>}
 */
export async function updateProduct(currentProducts, fileName, productData) {
  const fn =
    productData && Object.prototype.hasOwnProperty.call(productData, 'fileName')
      ? String(productData.fileName ?? '')
      : String(fileName || '')
  const next = applyProductDataToCatalog(currentProducts, productData)
  const persistResult = await persistCatalogSnapshotAndProducts(next, fn)
  return {
    products: next,
    fileName: fn,
    csvRowCount: countVariantRowsInProducts(next),
    persistOk: persistResult.ok,
    ...(persistResult.ok ? {} : { persistError: persistResult.error }),
  }
}
