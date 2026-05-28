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
/** Cột thời gian tạo trên Postgres (sau migration `products_created_at`). */
const PRODUCTS_CREATED_AT_COLUMN = 'created_at'

/** Danh sách cột SELECT — **phải có `quy_doi`** (và các cột catalog) khi đọc `products`. */
const PRODUCTS_FETCH_COLUMNS = [...CATALOG_PRODUCT_DB_COLUMNS, PRODUCTS_CREATED_AT_COLUMN].join(',')

/** Giới hạn `in('ma_hang', …)` mỗi request (độ dài URL PostgREST). */
const PRODUCTS_IN_QUERY_CHUNK = 200
/** Khi một lần upsert toàn bộ lỗi — tách song song (Promise.all). */
const PRODUCTS_UPSERT_FALLBACK_CHUNK = 1500

/** `ma_hang` → payload đã finalize — chỉ upsert dòng thay đổi thật sự. */
const productUpsertBaselineByMaHang = new Map()

/** Thông báo toast đỏ chuẩn khi ghi DB thất bại. */
export function catalogDbErrorToastMessage(err) {
  const detail = describeCatalogPersistError(err)
  return detail.startsWith('Lỗi DB:') ? detail : `Lỗi DB: ${detail}`
}

function stableSerializeFinalizedProductRow(row) {
  const keys = Object.keys(row).sort()
  const o = {}
  for (const k of keys) o[k] = row[k]
  return JSON.stringify(o)
}

/** Gọi sau khi đọc được danh mục từ Supabase/IDB (và sau revalidate). */
export function seedProductUpsertBaselineFromDisplayCatalog(products) {
  productUpsertBaselineByMaHang.clear()
  if (!Array.isArray(products) || products.length === 0) return
  const flat = flattenDisplayCatalogToVariants(products)
  const allow = new Set(CATALOG_PRODUCT_DB_COLUMNS)
  for (const v of flat) {
    const raw = pickProductRowDbColumns(displayVariantToProductsRow(v))
    const code = String(raw[PRODUCT_PK_COLUMN] ?? '').trim()
    if (!code) continue
    const fin = finalizeProductRowForSupabase(raw, allow)
    productUpsertBaselineByMaHang.set(code, stableSerializeFinalizedProductRow(fin))
  }
}

function filterFinalizedRowsDiffFromBaseline(rows) {
  if (!rows.length) return rows
  if (productUpsertBaselineByMaHang.size === 0) return rows
  const out = []
  for (const row of rows) {
    const code = String(row[PRODUCT_PK_COLUMN] ?? '').trim()
    if (!code) continue
    const ser = stableSerializeFinalizedProductRow(row)
    if (productUpsertBaselineByMaHang.get(code) === ser) continue
    out.push(row)
  }
  return out
}

function mergeBaselineFromUpsertReturnedRows(returnedRows) {
  if (!Array.isArray(returnedRows) || returnedRows.length === 0) return
  const allow = new Set(CATALOG_PRODUCT_DB_COLUMNS)
  for (const dbRow of returnedRows) {
    const raw = pickProductRowDbColumns(dbRow)
    const fin = finalizeProductRowForSupabase(raw, allow)
    const code = String(fin[PRODUCT_PK_COLUMN] ?? '').trim()
    if (!code) continue
    productUpsertBaselineByMaHang.set(code, stableSerializeFinalizedProductRow(fin))
  }
}

/**
 * PATCH một dòng `products.thuong_hieu` theo `ma_hang` — đảm bảo F5 vẫn thấy thương hiệu sau khi lưu tại tab Hàng hóa
 * (không phụ thuộc dedupe snapshot hay flush bulk).
 * @param {string} maHang — «Mã hàng» (`ma_hang`)
 * @param {unknown} brandUi — giá trị thương hiệu từ form (map sang cột `thuong_hieu`)
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: unknown }>}
 */
export async function updateProductThuongHieuByMaHang(maHang, brandUi) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const code = String(maHang ?? '').trim()
  if (!code) return { ok: false, error: new Error('Thiếu mã hàng.') }
  const sb = getSupabaseClient()
  if (!sb) {
    const err = new Error('Không tạo được Supabase client (thiếu env hoặc cấu hình).')
    return { ok: false, error: err }
  }
  const allow = new Set(['thuong_hieu'])
  const fin = finalizeProductRowForSupabase({ thuong_hieu: String(brandUi ?? '') }, allow)
  try {
    const { data, error } = await sb
      .from(PRODUCTS_TABLE)
      .update({ thuong_hieu: fin.thuong_hieu })
      .eq(PRODUCT_PK_COLUMN, code)
      .select('*')
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 0) {
      const err = new Error(
        `Không cập nhật được thương hiệu: không có dòng «products» với ${PRODUCT_PK_COLUMN}="${code}".`
      )
      notifySupabasePersistFailure(err)
      return { ok: false, error: err }
    }
    mergeBaselineFromUpsertReturnedRows(rows)
    return { ok: true }
  } catch (e) {
    notifySupabasePersistFailure(e)
    return { ok: false, error: e }
  }
}

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

/** Gửi lên Supabase dạng số JSON — không dùng `""` cho cột numeric trên Postgres. */
const PRODUCT_PAYLOAD_NUMBER_COLUMNS = new Set(['gia_ban', 'gia_von', 'ton_kho', 'quy_doi'])

function defaultNumberForProductPayloadColumn(column) {
  if (column === 'quy_doi') return 1
  if (column === 'ton_kho') return 0
  return 0
}

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
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    // Có cả hai dấu: ưu tiên chuẩn VN 1.234,56 -> 1234.56
    s = s.replace(/\./g, '').replace(/,/g, '.')
  } else if (lastComma >= 0) {
    // Chỉ có dấu phẩy: thập phân hoặc phân nghìn
    const tail = s.slice(lastComma + 1)
    s = tail.length === 3 ? s.replace(/,/g, '') : s.replace(/,/g, '.')
  } else if (lastDot >= 0) {
    // Chỉ có dấu chấm: có thể là thập phân JS (5208.3) hoặc phân nghìn (5.208)
    const tail = s.slice(lastDot + 1)
    s = tail.length === 3 ? s.replace(/\./g, '') : s
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return ''
  const fixed4 = Number(parseFloat(String(neg ? -n : n)).toFixed(4))
  if (!Number.isFinite(fixed4)) return ''
  return String(fixed4)
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

function notifySupabasePersistFailure(error, supabaseRowError) {
  const se =
    supabaseRowError ??
    (error && typeof error === 'object' && error.cause ? error.cause : null)
  if (se && typeof se === 'object') {
    const { message: m, details: d, hint: h } = se
    if (m != null || d != null || h != null) console.error(m, d, h)
  }
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
  const sqRaw = v?.stockQty ?? v?.ton_kho ?? v?.raw?.ton_kho
  const sqNum = Number(sqRaw)
  const tonKho =
    sqRaw != null && sqRaw !== '' && Number.isFinite(sqNum) ? sqNum : 0
  return {
    ma_hang: maHang,
    ma_vach: dbTextCell(v?.barcode),
    ten_hang: dbTextCell(v?.name),
    thuong_hieu: dbTextCell(v?.brand),
    gia_ban: v?.price,
    gia_von: v?.cost,
    ton_kho: tonKho,
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
 * Chỉ giữ các khóa có trong schema `products` — bỏ mọi trường UI (isEditing, tempId…).
 * @param {Record<string, unknown>} row
 */
function pickProductRowDbColumns(row) {
  const o = {}
  if (!row || typeof row !== 'object') return o
  for (const k of CATALOG_PRODUCT_DB_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(row, k)) o[k] = row[k]
  }
  return o
}

/**
 * Giữ đúng cột bảng SQL. `gia_ban`, `gia_von`, `ton_kho`, `quy_doi` → `Number` (mặc định hợp lệ nếu trống/sai).
 * Các cột amount còn lại: chuỗi đã dọn Kiot; cột text: {@link dbTextCell}.
 * @param {Record<string, unknown>} row
 * @param {Set<string>} allow
 */
function finalizeProductRowForSupabase(row, allow) {
  const o = {}
  for (const k of allow) {
    let raw = row[k]
    if (raw === undefined || raw === null) raw = ''

    if (PRODUCT_PAYLOAD_NUMBER_COLUMNS.has(k)) {
      const dec = cleanKiotAmountToDecimalString(raw)
      let n = dec === '' ? NaN : Number(dec)
      if (!Number.isFinite(n)) n = defaultNumberForProductPayloadColumn(k)
      o[k] = Number(parseFloat(String(n)).toFixed(4))
      continue
    }

    let out
    if (PRODUCT_AMOUNT_STRING_COLUMNS.has(k)) {
      out = cleanKiotAmountToDecimalString(raw)
      o[k] = String(out)
    } else {
      o[k] = dbTextCell(raw)
    }
  }
  return o
}

/** Trùng khóa `Mã hàng` trong một request — giữ bản cuối. */
function dedupeRowsByProductCode(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = String(r[PRODUCT_PK_COLUMN] ?? '').trim()
    if (!key) continue
    map.set(key, r)
  }
  return [...map.values()]
}

export function flattenDisplayCatalogToVariants(products) {
  if (!Array.isArray(products) || products.length === 0) return []
  return (Array.isArray(products) ? products : []).flatMap((p) =>
    Array.isArray(p.groupVariants) && p.groupVariants.length > 0 ? p.groupVariants : [p]
  )
}

/**
 * Chỉ cập nhật `ton_kho` trên `products` (PATCH), không gửi `gia_ban` / các cột khác — tránh đè giá server.
 * @param {Array<object>} flatDisplayVariants — biến thể phẳng (đủ `code`, `stockQty`)
 * @returns {Promise<{ ok: boolean, skipped?: boolean, written?: number, skippedUpdate?: number, error?: unknown }>}
 */
export async function saveProductsTonKhoPatchToSupabase(flatDisplayVariants) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb) {
    const err = new Error(
      '[saveProductsTonKhoPatchToSupabase] Không tạo được Supabase client (thiếu env hoặc cấu hình).'
    )
    notifySupabasePersistFailure(err)
    return { ok: false, error: err }
  }
  if (!Array.isArray(flatDisplayVariants) || flatDisplayVariants.length === 0) {
    return { ok: true, written: 0, skippedUpdate: 0 }
  }
  const tonByMa = new Map()
  for (const v of flatDisplayVariants) {
    const ma = String(v?.code ?? '').trim()
    if (!ma) continue
    const tonStr = cleanKiotAmountToDecimalString(v?.stockQty)
    let tonNum = tonStr === '' ? 0 : Number(tonStr)
    if (!Number.isFinite(tonNum)) tonNum = 0
    tonByMa.set(ma, tonNum)
  }
  if (tonByMa.size === 0) {
    const err = new Error('Cập nhật tồn: không có «Mã hàng» hợp lệ.')
    notifySupabasePersistFailure(err)
    return { ok: false, error: err }
  }
  const uniq = [...tonByMa.keys()]
  try {
    const fetchParts = []
    for (let i = 0; i < uniq.length; i += PRODUCTS_IN_QUERY_CHUNK) {
      fetchParts.push(uniq.slice(i, i + PRODUCTS_IN_QUERY_CHUNK))
    }
    const fetchedArrays = await Promise.all(
      fetchParts.map((part) =>
        sb.from(PRODUCTS_TABLE).select(PRODUCTS_FETCH_COLUMNS).in(PRODUCT_PK_COLUMN, part)
      )
    )
    const mergedFinal = []
    const allow = new Set(CATALOG_PRODUCT_DB_COLUMNS)
    let fetchErr = null
    for (const { data, error } of fetchedArrays) {
      if (error) {
        fetchErr = error
        break
      }
      for (const dbRow of data || []) {
        const ma = String(dbRow[PRODUCT_PK_COLUMN] ?? '').trim()
        if (!ma || !tonByMa.has(ma)) continue
        const raw = { ...pickProductRowDbColumns(dbRow), ton_kho: tonByMa.get(ma) }
        mergedFinal.push(finalizeProductRowForSupabase(raw, allow))
      }
    }
    if (fetchErr) {
      const err = new Error(
        describeCatalogPersistError(fetchErr) ||
          'Đọc «products» để cập nhật tồn: lỗi PostgREST (kiểm tra RLS).'
      )
      err.cause = fetchErr
      notifySupabasePersistFailure(err, fetchErr)
      return { ok: false, error: err, written: 0, skippedUpdate: uniq.length }
    }
    if (mergedFinal.length === 0) {
      const err = new Error(
        'Cập nhật tồn: không tìm thấy dòng «products» tương ứng các mã hàng (chưa có trên server?).'
      )
      notifySupabasePersistFailure(err)
      return { ok: false, error: err, written: 0, skippedUpdate: uniq.length }
    }
    const { written, skippedUpsert, lastSupabaseError, returnedProductRows } = await upsertRawProductRows(
      sb,
      mergedFinal,
      { bypassBaselineDiff: true }
    )
    const skippedUpdate = uniq.length - written
    if (written === 0) {
      const fromApi =
        lastSupabaseError != null ? describeCatalogPersistError(lastSupabaseError) : null
      const err = new Error(
        fromApi || `Cập nhật «ton_kho» bulk: không ghi được dòng nào (${skippedUpsert} lỗi).`
      )
      if (lastSupabaseError) err.cause = lastSupabaseError
      notifySupabasePersistFailure(err, lastSupabaseError)
      return { ok: false, error: err, written: 0, skippedUpdate: uniq.length }
    }
    return { ok: true, written, skippedUpdate: Math.max(0, skippedUpdate) }
  } catch (error) {
    notifySupabasePersistFailure(error)
    return { ok: false, error }
  }
}

function catalogSnapshotDedupeKey(products, fileName) {
  const flat = flattenDisplayCatalogToVariants(products || [])
  const sig = flat
    .map((v) =>
      [
        v.id,
        String(v.code ?? ''),
        String(v.name ?? ''),
        String(v.brand ?? ''),
        String(normalizeBarcodeValue(v.barcode ?? '')),
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
 * @returns {{ written: number, skipped: number, lastError?: object }}
 */
async function upsertProductChunkResilient(sb, part) {
  const missingCode = part.filter((row) => !String(row[PRODUCT_PK_COLUMN] ?? '').trim())
  if (missingCode.length > 0) {
    const err = new Error(
      `Upsert «products»: thiếu «${PRODUCT_PK_COLUMN}» trên ${missingCode.length} dòng.`
    )
    return { written: 0, skipped: part.length, lastError: err, returnedRows: [] }
  }
  // eslint-disable-next-line no-console
  console.log('Payload gửi lên Supabase:', part)
  const { data: upsertedRows, error: bulkError } = await sb
    .from(PRODUCTS_TABLE)
    .upsert(part, { onConflict: PRODUCT_PK_COLUMN })
    .select('*')
  if (bulkError) {
    const err = new Error(describeCatalogPersistError(bulkError))
    err.cause = bulkError
    console.error('[saveProductsToSupabase] Upsert lỗi:', formatSupabaseWriteError(bulkError))
    return { written: 0, skipped: part.length, lastError: bulkError, returnedRows: [] }
  }
  if (!Array.isArray(upsertedRows) || upsertedRows.length !== part.length) {
    const err = new Error(
      `Upsert «products»: phản hồi không đủ dòng (gửi ${part.length}, nhận ${upsertedRows?.length ?? 0}).`
    )
    return { written: 0, skipped: part.length, lastError: err, returnedRows: upsertedRows ?? [] }
  }
  // eslint-disable-next-line no-console
  console.log('[saveProductsToSupabase] Upsert trả về (select):', upsertedRows.length, 'dòng')
  return { written: part.length, skipped: 0, lastError: null, returnedRows: upsertedRows }
}

/**
 * @returns {Promise<{ written: number, skippedUpsert: number }>}
 */
/** Khớp tên cột Supabase (Unicode) — không gửi `imported_at` nếu bảng không có cột đó. */
const PRODUCT_ROW_KEYS_FOR_DB = new Set(CATALOG_PRODUCT_DB_COLUMNS)

/**
 * Upsert các dòng `products` — một request bulk; diff theo baseline; fallback Promise.all khi payload lớn lỗi.
 * @returns {{ written: number, skippedUpsert: number, lastSupabaseError?: object, returnedProductRows?: Array }}
 */
async function upsertRawProductRows(sb, rawRows, opts = {}) {
  const bypassBaselineDiff = opts && opts.bypassBaselineDiff === true
  const withCode = rawRows.filter((r) => String(r[PRODUCT_PK_COLUMN] ?? '').trim().length > 0)
  const skippedNoCode = rawRows.length - withCode.length
  if (skippedNoCode > 0) {
    console.warn(
      `[saveProductsToSupabase] Đã loại ${skippedNoCode} dòng không có «${PRODUCT_PK_COLUMN}», không gửi lên Supabase.`
    )
  }
  const deduped = dedupeRowsByProductCode(withCode)
  if (deduped.length < withCode.length) {
    console.warn(
      `[saveProductsToSupabase] Gộp trùng ${PRODUCT_PK_COLUMN}: ${withCode.length} → ${deduped.length} dòng (giữ bản sau cùng).`
    )
  }
  const allow = new Set(CATALOG_PRODUCT_DB_COLUMNS)
  const rows = deduped.map((row) => finalizeProductRowForSupabase(pickProductRowDbColumns(row), allow))
  if (rows.length === 0) return { written: 0, skippedUpsert: 0, lastSupabaseError: null, returnedProductRows: [] }

  const changed = bypassBaselineDiff ? rows : filterFinalizedRowsDiffFromBaseline(rows)
  if (changed.length === 0) {
    return { written: 0, skippedUpsert: 0, lastSupabaseError: null, returnedProductRows: [] }
  }

  const runPart = async (part) => upsertProductChunkResilient(sb, part)
  let agg = await runPart(changed)
  /** Chỉ tách song song khi cả đợt đầu không ghi được dòng nào (thường do payload quá lớn) — tránh upsert trùng khi đã ghi một phần. */
  const shouldParallelRetry =
    changed.length > PRODUCTS_UPSERT_FALLBACK_CHUNK &&
    agg.written === 0 &&
    agg.skipped > 0
  if (shouldParallelRetry) {
    const parts = []
    for (let i = 0; i < changed.length; i += PRODUCTS_UPSERT_FALLBACK_CHUNK) {
      parts.push(changed.slice(i, i + PRODUCTS_UPSERT_FALLBACK_CHUNK))
    }
    if (parts.length > 1) {
      const mul = await Promise.all(parts.map((p) => runPart(p)))
      agg = {
        written: mul.reduce((s, x) => s + x.written, 0),
        skipped: mul.reduce((s, x) => s + x.skipped, 0),
        lastError: mul.find((x) => x.lastError)?.lastError ?? null,
        returnedRows: (Array.isArray(mul) ? mul : []).flatMap((x) =>
          Array.isArray(x.returnedRows) ? x.returnedRows : []
        ),
      }
    }
  }

  if (Array.isArray(agg.returnedRows) && agg.returnedRows.length > 0) {
    mergeBaselineFromUpsertReturnedRows(agg.returnedRows)
  } else if (agg.written > 0 && agg.skipped === 0) {
    for (const fin of changed) {
      const code = String(fin[PRODUCT_PK_COLUMN] ?? '').trim()
      if (code) productUpsertBaselineByMaHang.set(code, stableSerializeFinalizedProductRow(fin))
    }
  }

  const skippedUpsert = agg.skipped ?? 0
  if (skippedUpsert > 0) {
    console.warn(
      `[saveProductsToSupabase] Đồng bộ xong: đã ghi ${agg.written}/${changed.length} dòng (sau diff); ${skippedUpsert} dòng bị bỏ qua do lỗi API.`
    )
  } else {
    console.log(
      `[saveProductsToSupabase] Upsert bulk: ${agg.written} dòng thay đổi / ${changed.length} (sau diff), tổng catalog ${rows.length} dòng.`
    )
  }
  return {
    written: agg.written,
    skippedUpsert,
    lastSupabaseError: agg.lastError ?? null,
    returnedProductRows: agg.returnedRows ?? [],
  }
}

async function upsertProductRowsFromDisplayCatalog(sb, products) {
  const flat = flattenDisplayCatalogToVariants(products || [])
  const rawRows = flat.map((v) => pickProductRowDbColumns(displayVariantToProductsRow(v)))
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
      `[saveProductsToSupabase] Bắt đầu: ${toSend.length} dòng có mã hợp lệ (đã gộp trùng), ` +
        `${flat.length} biến thể sau flatten — upsert bulk một lần + diff baseline; lỗi đợt sẽ thử từng dòng.`
    )
    const { written, skippedUpsert, lastSupabaseError } =
      await upsertProductRowsFromDisplayCatalog(sb, products || [])
    if (toSend.length > 0 && written === 0 && skippedUpsert > 0) {
      const fromApi =
        lastSupabaseError != null ? describeCatalogPersistError(lastSupabaseError) : null
      const err = new Error(
        fromApi ||
          `Upsert bảng «products»: không ghi được dòng nào (${skippedUpsert}/${toSend.length} bị bỏ qua).`
      )
      if (lastSupabaseError) err.cause = lastSupabaseError
      notifySupabasePersistFailure(err, lastSupabaseError)
      return { ok: false, error: err, written, skippedUpsert }
    }
    console.log('[saveProductsToSupabase] Hoàn tất.', { written, skippedUpsert })
    return { ok: true, written, skippedUpsert }
  } catch (error) {
    if (error && typeof error === 'object') {
      const { message: m, details: d, hint: h } = error
      if (m != null || d != null || h != null) console.error(m, d, h)
      else console.error(error)
    } else {
      console.error(error)
    }
    notifySupabasePersistFailure(error)
    return { ok: false, error }
  }
}

/**
 * `ma_hang` không trùng của các biến thể đang xóa khỏi catalog — dùng cho DELETE `public.products`.
 * @param {Array<object>} products — catalog nhóm + groupVariants
 * @param {Array<string|number>} variantIds — `variant.id`
 */
export function collectMaHangCodesForVariantIds(products, variantIds) {
  if (!Array.isArray(products) || !Array.isArray(variantIds) || variantIds.length === 0) return []
  const idSet = new Set(variantIds.map((x) => String(x)))
  const codes = []
  for (const p of products) {
    for (const gv of p.groupVariants || [p]) {
      if (!gv || !idSet.has(String(gv.id))) continue
      const code = String(gv.code ?? '').trim()
      if (code) codes.push(code)
    }
  }
  return [...new Set(codes)]
}

/**
 * Xóa biến thể đã gỡ khỏi catalog theo `ma_hang`.
 * @param {Array<object>} products — catalog trước khi sửa
 * @param {Array<string|number>} variantIds
 */
export async function deleteProductsForRemovedVariants(products, variantIds) {
  const codes = collectMaHangCodesForVariantIds(products, variantIds)
  return deleteProductsFromSupabaseByMaHang(codes)
}

/**
 * Xóa dòng trên `public.products` theo `ma_hang` (legacy / khi chưa có UUID).
 * @param {Iterable<string>} maHangList
 * @returns {Promise<{ ok: boolean, skipped?: boolean, deleted?: number, error?: unknown }>}
 */
export async function deleteProductsFromSupabaseByMaHang(maHangList) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb) {
    const err = new Error(
      '[deleteProductsFromSupabaseByMaHang] Không tạo được Supabase client (thiếu env hoặc cấu hình).'
    )
    notifySupabasePersistFailure(err)
    return { ok: false, error: err }
  }
  const uniq = [...new Set([...maHangList].map((x) => String(x ?? '').trim()).filter(Boolean))]
  if (uniq.length === 0) return { ok: true, deleted: 0 }
  try {
    // Fallback khi chưa có UUID `id` (catalog cũ).
    // eslint-disable-next-line no-console
    console.log('Payload xóa Supabase (products.delete theo ma_hang):', uniq)
    const chunks = []
    for (let i = 0; i < uniq.length; i += PRODUCTS_IN_QUERY_CHUNK) {
      chunks.push(uniq.slice(i, i + PRODUCTS_IN_QUERY_CHUNK))
    }
    const results = await Promise.all(
      chunks.map((chunk) => sb.from(PRODUCTS_TABLE).delete().in(PRODUCT_PK_COLUMN, chunk))
    )
    let deleted = 0
    for (const { error } of results) {
      if (error) {
        const err = new Error(
          describeCatalogPersistError(error) ||
            `Xóa bảng «products»: lỗi (${PRODUCT_PK_COLUMN}). Kiểm tra RLS policy DELETE.`
        )
        err.cause = error
        notifySupabasePersistFailure(err, error)
        return { ok: false, error, deleted }
      }
    }
    deleted = uniq.length
    console.log(`[deleteProductsFromSupabaseByMaHang] Đã xóa ${deleted} dòng (${PRODUCT_PK_COLUMN}).`)
    return { ok: true, deleted }
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
  const rawRows = flatDisplayVariants.map((v) => pickProductRowDbColumns(displayVariantToProductsRow(v)))
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
    const { written, skippedUpsert, lastSupabaseError, returnedProductRows } = await upsertRawProductRows(
      sb,
      rawRows,
      { bypassBaselineDiff: true }
    )
    if (written === 0 && skippedUpsert > 0) {
      const fromApi =
        lastSupabaseError != null ? describeCatalogPersistError(lastSupabaseError) : null
      const err = new Error(
        fromApi ||
          `Upsert bảng «products»: không ghi được dòng nào (${skippedUpsert}/${eligible.length} bị bỏ qua).`
      )
      if (lastSupabaseError) err.cause = lastSupabaseError
      notifySupabasePersistFailure(err, lastSupabaseError)
      return { ok: false, error: err, written, skippedUpsert }
    }
    const returnedDisplayVariants = (returnedProductRows || [])
      .map((row, i) => supabaseProductRowToFlatCatalogRow(row, i))
      .filter(Boolean)
    return { ok: true, written, skippedUpsert, returnedDisplayVariants }
  } catch (error) {
    if (error && typeof error === 'object') {
      const { message: m, details: d, hint: h } = error
      if (m != null || d != null || h != null) console.error(m, d, h)
      else console.error(error)
    } else {
      console.error(error)
    }
    notifySupabasePersistFailure(error)
    return { ok: false, error }
  }
}

/**
 * Ghi snapshot (Supabase/IDB) rồi đồng bộ bảng `products`.
 * Khi có Supabase: `ok` chỉ là `true` nếu bước upsert `products` thành công — tránh đọc lại từ server rồi đè UI bằng dữ liệu cũ (snapshot có thể mới nhưng `products` đọc ưu tiên không khớp).
 * @param {object} [options]
 * @param {Array<object>} [options.upsertOnlyVariants] — nếu có: chỉ upsert các biến thể này lên `products`, vẫn ghi snapshot đầy đủ `products`.
 * @param {Array<object>} [options.tonKhoOnlyVariants] — nếu truyền (kể cả mảng rỗng): chỉ **PATCH** cột `ton_kho` — không đụng `gia_ban`.
 * @returns {Promise<{ ok: boolean, error?: unknown, snapshotSaved?: boolean }>}
 */
export async function persistCatalogSnapshotAndProducts(products, fileName, options) {
  if (!isSupabaseConfigured()) {
    await saveCatalogSnapshot(products, fileName)
    return { ok: true }
  }
  if (options?.tonKhoOnlyVariants != null) {
    await saveCatalogSnapshot(products, fileName)
    const r = await saveProductsTonKhoPatchToSupabase(options.tonKhoOnlyVariants)
    return r.ok ? { ok: true, snapshotSaved: true } : { ok: false, error: r.error, snapshotSaved: true }
  }
  if (options?.upsertOnlyVariants?.length) {
    await saveCatalogSnapshot(products, fileName)
    const r = await saveProductsToSupabaseUpsertOnly(options.upsertOnlyVariants)
    return r.ok
      ? { ok: true, snapshotSaved: true, returnedDisplayVariants: r.returnedDisplayVariants }
      : { ok: false, error: r.error, snapshotSaved: true }
  }
  await saveCatalogSnapshot(products, fileName)
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
  let conversion =
    v.conversion == null || v.conversion === '' ? null : parseConversionRatio(String(v.conversion))
  let conversionValue =
    v.conversionValue == null || v.conversionValue === ''
      ? null
      : parseConversionRatio(String(v.conversionValue))
  const qSrc = v.quy_doi ?? v.quyDoi ?? v.raw?.quy_doi
  let fromQuy = null
  if (qSrc != null && qSrc !== '') {
    const n = Number(qSrc)
    if (Number.isFinite(n) && n > 0) fromQuy = n
    else {
      const p = parseConversionRatio(String(qSrc))
      if (p != null && p > 0) fromQuy = p
    }
  }
  if (conversion == null && fromQuy != null) conversion = fromQuy
  if (conversionValue == null && fromQuy != null) conversionValue = fromQuy
  return {
    ...v,
    price: parsePrice(v.price),
    wholesalePrice: parsePrice(v.wholesalePrice),
    cost: parsePrice(v.cost),
    stockQty: parseStockQty(v.stockQty),
    stockNormMin: v.stockNormMin == null || v.stockNormMin === '' ? null : parseStockQty(v.stockNormMin),
    stockNormMax: v.stockNormMax == null || v.stockNormMax === '' ? null : parseStockQty(v.stockNormMax),
    conversion,
    conversionValue,
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
 * Có cột `created_at` trong schema PostgREST → sắp mới nhất trước; không → sắp theo khóa chính `ma_hang` giảm dần.
 */
async function resolveSupabaseProductsOrderColumn(sb) {
  const pk = PRODUCT_PK_COLUMN
  const probe = await sb
    .from(PRODUCTS_TABLE)
    .select(pk)
    .order(PRODUCTS_CREATED_AT_COLUMN, { ascending: false })
    .order(pk, { ascending: false })
    .limit(1)
  if (!probe.error) return PRODUCTS_CREATED_AT_COLUMN
  const fb = await sb.from(PRODUCTS_TABLE).select(pk).order(pk, { ascending: false }).limit(1)
  if (!fb.error) return pk
  throw probe.error || fb.error || new Error('Không đọc được «products» (kiểm tra schema / RLS).')
}

/** `created_at` ISO từ PostgREST → ms cho UI POS (lưới Hàng hóa…); fallback không đổi hành vi cũ. */
function createdAtMsFromSupabaseProductRow(row, rowIndexFallback) {
  const raw = row?.[PRODUCTS_CREATED_AT_COLUMN]
  if (raw != null && raw !== '') {
    const ms = Date.parse(String(raw))
    if (Number.isFinite(ms)) return ms
  }
  return Date.now() + rowIndexFallback
}

/**
 * Đọc toàn bộ `public.products` (phân trang PostgREST) — **mặc định mới nhất trước** (created_at DESC nếu có).
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 */
async function fetchAllProductRows(sb) {
  const sortBy = await resolveSupabaseProductsOrderColumn(sb)
  const pageSize = 1000
  let from = 0
  const all = []
  for (;;) {
    const to = from + pageSize - 1
    let req = sb.from(PRODUCTS_TABLE).select(PRODUCTS_FETCH_COLUMNS)
    if (sortBy === PRODUCTS_CREATED_AT_COLUMN) {
      req = req
        .order(PRODUCTS_CREATED_AT_COLUMN, { ascending: false })
        .order(PRODUCT_PK_COLUMN, { ascending: false })
    } else {
      req = req.order(PRODUCT_PK_COLUMN, { ascending: false })
    }
    const { data, error } = await req.range(from, to)
    if (error) throw error
    const chunk = data || []
    all.push(...chunk)
    if (chunk.length < pageSize) break
    from += pageSize
  }
  return all
}

const MA_HANG_LOOKUP_CHUNK = 200

/**
 * Đọc `gia_von` + `ton_kho` từ `public.products` theo `ma_hang` — dùng bình quân gia quyền nhập hàng khớp server.
 * @param {Iterable<string>} maHangKeys
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
export async function fetchProductsCostAndStockByMaHang(maHangKeys) {
  const uniq = [...new Set([...maHangKeys].map((x) => String(x ?? '').trim()).filter(Boolean))]
  const map = new Map()
  if (uniq.length === 0 || !isSupabaseConfigured()) return map
  const sb = getSupabaseClient()
  if (!sb) return map
  for (let i = 0; i < uniq.length; i += MA_HANG_LOOKUP_CHUNK) {
    const part = uniq.slice(i, i + MA_HANG_LOOKUP_CHUNK)
    const { data, error } = await sb
      .from(PRODUCTS_TABLE)
      .select(`${PRODUCT_PK_COLUMN}, gia_von, ton_kho, quy_doi`)
      .in(PRODUCT_PK_COLUMN, part)
    if (error) throw error
    for (const row of data || []) {
      const k = String(row[PRODUCT_PK_COLUMN] ?? '').trim()
      if (k) map.set(k, row)
    }
  }
  return map
}

/**
 * Cột `quy_doi` trên Supabase (số / chuỗi Kiot) → hệ số dương hoặc null.
 * Luôn thử `Number()` trước để không bỏ lỡ kiểu numeric từ PostgREST.
 */
function parseQuyDoiFromProductsTableRow(row) {
  const raw = row?.quy_doi
  if (raw != null && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
    const p = parseConversionRatio(String(raw).trim())
    if (p != null && p > 0) return p
  }
  return null
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
  const conversion = parseQuyDoiFromProductsTableRow(row)
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
    quy_doi: row.quy_doi,
    ...(conversion != null ? { conversionValue: conversion } : {}),
    weightRaw: String(row.trong_luong ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    stockNormMin,
    stockNormMax,
    createdAtMs: createdAtMsFromSupabaseProductRow(row, rowIndex),
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
  const r = await fetchCatalogSnapshotFromPersistentStore()
  if (r?.products?.length) seedProductUpsertBaselineFromDisplayCatalog(r.products)
  return r
}

/**
 * Tải lại danh mục từ nguồn bền (Supabase `products` / snapshot, …) — dùng sau insert/update như mutate/revalidate.
 * @returns {Promise<{ products: Array, fileName: string, csvRowCount: number } | null>}
 */
export async function revalidateCatalogFromStore() {
  const r = await fetchCatalogSnapshotFromPersistentStore()
  if (r?.products?.length) seedProductUpsertBaselineFromDisplayCatalog(r.products)
  return r
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
    const flat = (Array.isArray(products) ? products : []).flatMap((p) => p.groupVariants || [p])
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
    const flat = (Array.isArray(products) ? products : [])
      .flatMap((p) => p.groupVariants || [p])
      .filter((v) => !idSet.has(v.id))
    if (flat.length === 0) return []
    return prepareCatalogForPosSearch(buildDisplayCatalog(flat))
  }
  if (type === 'replace_group') {
    const { anchorVariantId, replacements } = productData
    if (anchorVariantId == null || !Array.isArray(replacements) || replacements.length === 0) {
      return products
    }
    const flat = (Array.isArray(products) ? products : []).flatMap((p) => p.groupVariants || [p])
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
    const flat = (Array.isArray(products) ? products : []).flatMap((p) => p.groupVariants || [p])
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

export { insertInboundHistoryEntry, INBOUND_HISTORY_TABLE } from './supabaseInboundHistory.js'
