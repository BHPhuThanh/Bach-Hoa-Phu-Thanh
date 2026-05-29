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
import {
  CATALOG_PRODUCT_TYPE_COMBO,
  getComboBom,
  isComboCatalogProduct,
} from './comboCatalog.js'
import {
  ensureUniqueMaHangAndBarcodeForNewRows,
  formatHhSkuFromSequence,
  isValidAutoHhMaHang,
  maxValidHhMaHangNumber,
  nextAutoHhMaHangFromMax,
  parseHhNumericSku,
} from './autoProductSku.js'
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

const PRODUCT_BOOLEAN_COLUMNS = new Set(['is_combo'])
const PRODUCT_JSONB_COLUMNS = new Set(['combo_bom'])

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

/** Xếp hàng ghi snapshot — không bỏ qua lệnh khi đang ghi. */
let saveCatalogSnapshotQueue = Promise.resolve()
/** Bỏ qua lưu trùng cùng nội dung ngay sau lần trước (giảm spam). */
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
function variantIsComboForPersist(v) {
  if (!v) return false
  if (v.catalogProductType === CATALOG_PRODUCT_TYPE_COMBO) return true
  if (v.isCombo === true) return true
  const bom = v.comboBom
  return Array.isArray(bom) && bom.length > 0
}

/** BOM từ cột `combo_bom` (jsonb / chuỗi JSON). */
export function parseComboBomFromProductsDbRow(row) {
  const raw = row?.combo_bom
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object') return Array.isArray(raw) ? raw : []
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw)
      return Array.isArray(j) ? j : []
    } catch {
      return []
    }
  }
  return []
}

function readIsComboFromProductsDbRow(row) {
  if (!row) return false
  if (row.is_combo === true || row.is_combo === 'true' || row.is_combo === 't' || row.is_combo === 1) {
    return true
  }
  if (String(row.loai_san_pham ?? '').trim().toLowerCase() === CATALOG_PRODUCT_TYPE_COMBO) {
    return true
  }
  return parseComboBomFromProductsDbRow(row).length > 0
}

/** Gắn metadata combo lên biến thể display (sau đọc `products` hoặc snapshot). */
export function applyComboMetadataToDisplayVariant(v, comboSource) {
  if (!v || !comboSource) return v
  const isCombo =
    comboSource.catalogProductType === CATALOG_PRODUCT_TYPE_COMBO ||
    comboSource.isCombo === true ||
    (Array.isArray(comboSource.comboBom) && comboSource.comboBom.length > 0)
  if (!isCombo) return v
  const bom = Array.isArray(comboSource.comboBom) ? comboSource.comboBom : []
  return {
    ...v,
    catalogProductType: CATALOG_PRODUCT_TYPE_COMBO,
    isCombo: true,
    comboBom: bom,
    ...(comboSource.comboCostOverride != null ? { comboCostOverride: comboSource.comboCostOverride } : {}),
  }
}

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
  const isCombo = variantIsComboForPersist(v)
  const comboBom = isCombo && Array.isArray(v?.comboBom) ? v.comboBom : []
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
    is_combo: isCombo,
    loai_san_pham: isCombo ? CATALOG_PRODUCT_TYPE_COMBO : '',
    combo_bom: comboBom,
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

    if (PRODUCT_BOOLEAN_COLUMNS.has(k)) {
      o[k] = raw === true || raw === 'true' || raw === 't' || raw === 1 || raw === '1'
      continue
    }

    if (PRODUCT_JSONB_COLUMNS.has(k)) {
      let val = raw
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val)
        } catch {
          val = []
        }
      }
      o[k] = Array.isArray(val) ? val : []
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
 * Bulk insert một đợt (tạo mới hàng loạt — một request PostgREST).
 * @returns {Promise<{ written: number, skipped: number, lastError?: object, returnedRows?: Array }>}
 */
async function insertProductChunkResilient(sb, part) {
  const missingCode = part.filter((row) => !String(row[PRODUCT_PK_COLUMN] ?? '').trim())
  if (missingCode.length > 0) {
    const err = new Error(
      `Insert «products»: thiếu «${PRODUCT_PK_COLUMN}» trên ${missingCode.length} dòng.`
    )
    return { written: 0, skipped: part.length, lastError: err, returnedRows: [] }
  }
  // eslint-disable-next-line no-console
  console.log('Bulk insert products (một request):', part)
  const { data: insertedRows, error: bulkError } = await sb
    .from(PRODUCTS_TABLE)
    .insert(part)
    .select('*')
  if (bulkError) {
    console.error('[saveProductsToSupabase] Insert lỗi:', formatSupabaseWriteError(bulkError))
    return { written: 0, skipped: part.length, lastError: bulkError, returnedRows: [] }
  }
  if (!Array.isArray(insertedRows) || insertedRows.length !== part.length) {
    const err = new Error(
      `Insert «products»: phản hồi không đủ dòng (gửi ${part.length}, nhận ${insertedRows?.length ?? 0}).`
    )
    return { written: 0, skipped: part.length, lastError: err, returnedRows: insertedRows ?? [] }
  }
  return { written: part.length, skipped: 0, lastError: null, returnedRows: insertedRows }
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

function isPostgrestUniqueViolation(error) {
  if (!error || typeof error !== 'object') return false
  const code = String(error.code ?? '')
  if (code === '23505') return true
  const msg = String(error.message ?? '').toLowerCase()
  return msg.includes('duplicate') || msg.includes('unique')
}

/**
 * Insert bulk các dòng `products` mới — một request; fallback upsert nếu trùng khóa (đã tồn tại).
 */
async function insertRawProductRows(sb, rawRows) {
  const withCode = rawRows.filter((r) => String(r[PRODUCT_PK_COLUMN] ?? '').trim().length > 0)
  const skippedNoCode = rawRows.length - withCode.length
  if (skippedNoCode > 0) {
    console.warn(
      `[saveProductsToSupabase] Insert: loại ${skippedNoCode} dòng không có «${PRODUCT_PK_COLUMN}».`
    )
  }
  const deduped = dedupeRowsByProductCode(withCode)
  const allow = new Set(CATALOG_PRODUCT_DB_COLUMNS)
  const rows = deduped.map((row) => finalizeProductRowForSupabase(pickProductRowDbColumns(row), allow))
  if (rows.length === 0) {
    return { written: 0, skippedUpsert: 0, lastSupabaseError: null, returnedProductRows: [] }
  }

  let agg = await insertProductChunkResilient(sb, rows)
  if (agg.written === 0 && isPostgrestUniqueViolation(agg.lastError)) {
    console.warn('[saveProductsToSupabase] Insert trùng khóa — fallback upsert cùng batch.')
    agg = await upsertProductChunkResilient(sb, rows)
  }

  if (Array.isArray(agg.returnedRows) && agg.returnedRows.length > 0) {
    mergeBaselineFromUpsertReturnedRows(agg.returnedRows)
  } else if (agg.written > 0) {
    for (const fin of rows) {
      const code = String(fin[PRODUCT_PK_COLUMN] ?? '').trim()
      if (code) productUpsertBaselineByMaHang.set(code, stableSerializeFinalizedProductRow(fin))
    }
  }

  const skippedUpsert = agg.skipped ?? 0
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

function variantMarkedForDeletionIsCombo(gv) {
  if (!gv) return false
  if (gv.catalogProductType === CATALOG_PRODUCT_TYPE_COMBO || gv.isCombo === true) return true
  return getComboBom({ ...gv, groupVariants: [gv] }).length > 0
}

/**
 * `ma_hang` không trùng của các biến thể đang xóa khỏi catalog — dùng cho DELETE `public.products`.
 * @param {Array<object>} products — catalog nhóm + groupVariants
 * @param {Array<string|number>} variantIds — `variant.id`
 */
export function collectMaHangCodesForVariantIds(products, variantIds) {
  return collectMaHangCodesForVariantDeletion(products, variantIds)
}

/**
 * Mã hàng cần xóa khi gỡ biến thể — chỉ mã dòng được chọn, không gồm mã thành phần trong BOM combo.
 */
export function collectMaHangCodesForVariantDeletion(products, variantIds) {
  if (!Array.isArray(products) || !Array.isArray(variantIds) || variantIds.length === 0) return []
  const idSet = new Set(variantIds.map((x) => String(x)))
  const bomComponentCodes = new Set()
  for (const p of products) {
    for (const gv of p.groupVariants || [p]) {
      if (!gv || !idSet.has(String(gv.id))) continue
      if (!variantMarkedForDeletionIsCombo(gv)) continue
      for (const row of getComboBom({ ...gv, groupVariants: [gv] })) {
        const snap = String(row.codeSnap ?? '').trim()
        if (snap) bomComponentCodes.add(snap)
      }
    }
  }
  const codes = []
  for (const p of products) {
    for (const gv of p.groupVariants || [p]) {
      if (!gv || !idSet.has(String(gv.id))) continue
      const code = String(gv.code ?? '').trim()
      if (!code) continue
      if (bomComponentCodes.has(code) && !variantMarkedForDeletionIsCombo(gv)) continue
      codes.push(code)
    }
  }
  return [...new Set(codes)]
}

/** Bước 1 xóa combo: gỡ liên kết BOM trên `products` (jsonb), không đụng dòng thành phần lẻ. */
export async function clearComboProductLinksOnSupabase(maHangList) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb) {
    const err = new Error('[clearComboProductLinksOnSupabase] Không tạo được Supabase client.')
    notifySupabasePersistFailure(err)
    return { ok: false, error: err }
  }
  const uniq = [...new Set([...maHangList].map((x) => String(x ?? '').trim()).filter(Boolean))]
  if (uniq.length === 0) return { ok: true, cleared: 0 }
  try {
    const chunks = []
    for (let i = 0; i < uniq.length; i += PRODUCTS_IN_QUERY_CHUNK) {
      chunks.push(uniq.slice(i, i + PRODUCTS_IN_QUERY_CHUNK))
    }
    for (const chunk of chunks) {
      const { error } = await sb
        .from(PRODUCTS_TABLE)
        .update({
          combo_bom: [],
          is_combo: false,
          loai_san_pham: '',
        })
        .in(PRODUCT_PK_COLUMN, chunk)
      if (error) {
        const err = new Error(
          describeCatalogPersistError(error) ||
            'Gỡ liên kết combo (combo_bom) trên «products» thất bại.'
        )
        err.cause = error
        notifySupabasePersistFailure(err, error)
        return { ok: false, error }
      }
    }
    return { ok: true, cleared: uniq.length }
  } catch (error) {
    notifySupabasePersistFailure(error)
    return { ok: false, error }
  }
}

function collectComboMaHangForVariantDeletion(products, variantIds) {
  if (!Array.isArray(products) || !Array.isArray(variantIds) || variantIds.length === 0) return []
  const idSet = new Set(variantIds.map((x) => String(x)))
  const codes = []
  for (const p of products) {
    for (const gv of p.groupVariants || [p]) {
      if (!gv || !idSet.has(String(gv.id))) continue
      if (!variantMarkedForDeletionIsCombo(gv) && !isComboCatalogProduct(p)) continue
      const code = String(gv.code ?? '').trim()
      if (code) codes.push(code)
    }
  }
  return [...new Set(codes)]
}

/**
 * Xóa biến thể đã gỡ khỏi catalog: combo → xóa BOM (jsonb) rồi xóa dòng combo; không cascade thành phần.
 * @param {Array<object>} products — catalog trước khi sửa
 * @param {Array<string|number>} variantIds
 */
export async function deleteProductsForRemovedVariants(products, variantIds) {
  const codes = collectMaHangCodesForVariantDeletion(products, variantIds)
  const comboCodes = collectComboMaHangForVariantDeletion(products, variantIds)
  if (comboCodes.length > 0) {
    const clearR = await clearComboProductLinksOnSupabase(comboCodes)
    if (!clearR.ok && !clearR.skipped) return clearR
  }
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
 * Ghi các biến thể mới/sửa lên `products` — mặc định bulk insert một request (tạo hàng loạt).
 * @param {Array<object>} flatDisplayVariants — dòng phẳng POS (giống phần tử trong groupVariants).
 * @param {object} [options]
 * @param {Array<object>} [options.existingCatalogProducts] — catalog hiện có (để sinh mã HH/QR duy nhất).
 * @param {boolean} [options.useBulkInsert=true] — `insert` một lần; `false` → upsert (sửa giá vốn…).
 * @returns {Promise<{ ok: boolean, skipped?: boolean, written?: number, skippedUpsert?: number, error?: unknown }>}
 */
export async function saveProductsToSupabaseUpsertOnly(flatDisplayVariants, options = {}) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const sb = getSupabaseClient()
  if (!sb || !flatDisplayVariants?.length) return { ok: true }
  const existingCatalog = Array.isArray(options.existingCatalogProducts)
    ? options.existingCatalogProducts
    : []
  const useBulkInsert = options.useBulkInsert === true
  const uniqueVariants = ensureUniqueMaHangAndBarcodeForNewRows(existingCatalog, flatDisplayVariants)
  const rawRows = uniqueVariants.map((v) => pickProductRowDbColumns(displayVariantToProductsRow(v)))
  const eligible = dedupeRowsByProductCode(
    rawRows.filter((r) => String(r[PRODUCT_PK_COLUMN] ?? '').trim().length > 0)
  )
  try {
    if (eligible.length === 0) {
      const err = new Error(
        'Ghi «products»: không có «Mã hàng» hợp lệ trong nhóm biến thể.'
      )
      notifySupabasePersistFailure(err)
      return { ok: false, error: err }
    }
    console.log(
      `[saveProductsToSupabase] Ghi ${eligible.length} dòng (${useBulkInsert ? 'bulk insert' : 'upsert'}), không đồng bộ toàn catalog.`
    )
    const persistFn = useBulkInsert ? insertRawProductRows : upsertRawProductRows
    const persistOpts = useBulkInsert ? {} : { bypassBaselineDiff: true }
    const rowsForDb = uniqueVariants.map((v) =>
      pickProductRowDbColumns(displayVariantToProductsRow(v))
    )
    const { written, skippedUpsert, lastSupabaseError, returnedProductRows } = await persistFn(
      sb,
      rowsForDb,
      persistOpts
    )
    if (written === 0 && skippedUpsert > 0) {
      const fromApi =
        lastSupabaseError != null ? describeCatalogPersistError(lastSupabaseError) : null
      const err = new Error(
        fromApi ||
          `Ghi bảng «products»: không ghi được dòng nào (${skippedUpsert}/${eligible.length} bị bỏ qua).`
      )
      if (lastSupabaseError) err.cause = lastSupabaseError
      notifySupabasePersistFailure(err, lastSupabaseError)
      return { ok: false, error: err, written, skippedUpsert }
    }
    const returnedDisplayVariants = (returnedProductRows || [])
      .map((row, i) => supabaseProductRowToFlatCatalogRow(row, i))
      .filter(Boolean)
    return {
      ok: true,
      written,
      skippedUpsert,
      returnedDisplayVariants,
      preparedVariants: uniqueVariants,
    }
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
 * @param {Array<object>} [options.upsertOnlyVariants] — chỉ upsert các biến thể này lên `products` (mặc định **không** ghi snapshot).
 * @param {boolean} [options.snapshotOnly] — chỉ ghi `catalog_snapshots` (sao lưu / sau xóa hàng loạt).
 * @param {boolean} [options.withSnapshot] — ép ghi thêm `catalog_snapshots` khi dùng `upsertOnlyVariants` / `tonKhoOnlyVariants`.
 * @param {boolean} [options.skipSnapshot] — bỏ qua snapshot (mặc định `true` với upsert/tồn kho từng phần).
 * @param {Array<object>} [options.tonKhoOnlyVariants] — chỉ **PATCH** cột `ton_kho` — không đụng `gia_ban`.
 * @returns {Promise<{ ok: boolean, error?: unknown, snapshotSaved?: boolean, productsWritten?: boolean }>}
 */
export async function persistCatalogSnapshotAndProducts(products, fileName, options) {
  if (!isSupabaseConfigured()) {
    await saveCatalogSnapshot(products, fileName)
    return { ok: true, snapshotSaved: true, productsWritten: true }
  }

  if (options?.snapshotOnly) {
    try {
      await saveCatalogSnapshot(products, fileName)
      return { ok: true, snapshotSaved: true, productsWritten: true }
    } catch (error) {
      notifySupabasePersistFailure(error)
      return { ok: false, error, snapshotSaved: false, productsWritten: false }
    }
  }

  if (options?.tonKhoOnlyVariants != null) {
    try {
      const r = await saveProductsTonKhoPatchToSupabase(options.tonKhoOnlyVariants)
      if (!r.ok) {
        return { ok: false, error: r.error, snapshotSaved: false, productsWritten: false }
      }
      const writeSnapshot = options.withSnapshot === true
      if (writeSnapshot) {
        await saveCatalogSnapshot(products, fileName)
      }
      return { ok: true, snapshotSaved: writeSnapshot, productsWritten: true }
    } catch (error) {
      notifySupabasePersistFailure(error)
      return { ok: false, error, snapshotSaved: false, productsWritten: false }
    }
  }

  if (options?.upsertOnlyVariants?.length) {
    return persistCatalogProductsOnly(options.upsertOnlyVariants, {
      existingCatalogProducts: products,
      useBulkInsert: options.useBulkInsert === true,
      withSnapshot: options.withSnapshot === true,
    })
  }

  try {
    const r = await saveProductsToSupabase(products)
    if (!r.ok) {
      return {
        ok: false,
        error: r.error,
        snapshotSaved: false,
        productsWritten: false,
      }
    }
    await saveCatalogSnapshot(products, fileName)
    return { ok: true, snapshotSaved: true, productsWritten: true }
  } catch (error) {
    notifySupabasePersistFailure(error)
    return { ok: false, error, snapshotSaved: false, productsWritten: false }
  }
}

/**
 * Lấy toàn bộ `ma_hang` từ Supabase (phân trang) — không dùng state local.
 * @returns {Promise<string[]>}
 */
export async function fetchAllMaHangCodesFromSupabase() {
  if (!isSupabaseConfigured()) return []
  const sb = getSupabaseClient()
  if (!sb) return []
  const pageSize = 1000
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await sb
      .from(PRODUCTS_TABLE)
      .select(PRODUCT_PK_COLUMN)
      .range(from, from + pageSize - 1)
    if (error) throw error
    const chunk = data || []
    for (const row of chunk) {
      const c = String(row?.[PRODUCT_PK_COLUMN] ?? '').trim()
      if (c) all.push(c)
    }
    if (chunk.length < pageSize) break
    from += pageSize
  }
  return all
}

/**
 * Max số trong `ma_hang` trên Supabase (parseInt sau khi bỏ ký tự không phải số).
 * @returns {Promise<number>}
 */
export async function fetchMaxMaHangNumericFromSupabase() {
  const codes = await fetchAllMaHangCodesFromSupabase()
  return maxValidHhMaHangNumber(codes)
}

/** @deprecated Dùng {@link fetchMaxMaHangNumericFromSupabase} */
export async function fetchMaxHhNumericSequenceFromSupabase() {
  return fetchMaxMaHangNumericFromSupabase()
}

function finalizeDisplayVariantForDbWrite(variant, { omitMaHang = false } = {}) {
  const raw = pickProductRowDbColumns(displayVariantToProductsRow(variant))
  const allow = new Set(
    omitMaHang
      ? CATALOG_PRODUCT_DB_COLUMNS.filter((k) => k !== PRODUCT_PK_COLUMN)
      : CATALOG_PRODUCT_DB_COLUMNS
  )
  return finalizeProductRowForSupabase(raw, allow)
}

/**
 * UPDATE trực tiếp một dòng `products` theo `ma_hang` (không snapshot, không bulk).
 */
export async function updateSingleProductFromDisplayVariant(variant) {
  if (!isSupabaseConfigured()) return { ok: true, skipped: true }
  const maHang = String(variant?.code ?? '').trim()
  if (!maHang) {
    return { ok: false, error: new Error('Thiếu mã hàng (ma_hang) để cập nhật.') }
  }
  const sb = getSupabaseClient()
  if (!sb) {
    return { ok: false, error: new Error('Không tạo được Supabase client.') }
  }
  const fin = finalizeDisplayVariantForDbWrite(variant, { omitMaHang: true })
  try {
    const { data, error } = await sb
      .from(PRODUCTS_TABLE)
      .update(fin)
      .eq(PRODUCT_PK_COLUMN, maHang)
      .select('*')
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 0) {
      return { ok: true, updated: false, rows: 0 }
    }
    mergeBaselineFromUpsertReturnedRows(rows)
    return {
      ok: true,
      updated: true,
      rows: rows.length,
      displayVariant: supabaseProductRowToFlatCatalogRow(rows[0], 0),
    }
  } catch (e) {
    notifySupabasePersistFailure(e)
    return { ok: false, error: e }
  }
}

/**
 * INSERT trực tiếp một dòng `products` (không snapshot, không bulk).
 */
export async function insertSingleProductFromDisplayVariant(variant) {
  if (!isSupabaseConfigured()) {
    console.error('Lỗi Insert Supabase:', new Error('Supabase chưa cấu hình (VITE_SUPABASE_URL / ANON_KEY).'))
    return { ok: false, error: new Error('Supabase chưa cấu hình.') }
  }
  const maHang = String(variant?.code ?? '').trim()
  if (!maHang) {
    const err = new Error('Thiếu mã hàng (ma_hang) để thêm mới.')
    console.error('Lỗi Insert Supabase:', err)
    return { ok: false, error: err }
  }
  const sb = getSupabaseClient()
  if (!sb) {
    const err = new Error('Không tạo được Supabase client.')
    console.error('Lỗi Insert Supabase:', err)
    return { ok: false, error: err }
  }
  let fin
  try {
    fin = finalizeDisplayVariantForDbWrite(variant)
  } catch (prepErr) {
    console.error('Lỗi Insert Supabase:', prepErr)
    return { ok: false, error: prepErr }
  }
  const insertRows = [fin]
  // eslint-disable-next-line no-console
  console.log('Bắt đầu gửi lên Supabase...', insertRows)
  try {
    const { data, error } = await sb.from(PRODUCTS_TABLE).insert(insertRows).select('*')
    if (error) {
      console.error('Lỗi Insert Supabase:', error)
      throw error
    }
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 0) {
      const err = new Error(`Insert «products» không trả về dòng cho ${PRODUCT_PK_COLUMN}="${maHang}".`)
      console.error('Lỗi Insert Supabase:', err)
      notifySupabasePersistFailure(err)
      return { ok: false, error: err }
    }
    mergeBaselineFromUpsertReturnedRows(rows)
    // eslint-disable-next-line no-console
    console.log('Insert Supabase thành công:', maHang)
    return {
      ok: true,
      displayVariant: supabaseProductRowToFlatCatalogRow(rows[0], 0),
    }
  } catch (e) {
    console.error('Lỗi Insert Supabase:', e)
    notifySupabasePersistFailure(e)
    return { ok: false, error: e }
  }
}

/**
 * Cập nhật lần lượt từng biến thể — dùng cho sửa giá/tồn/1 vài SP.
 */
export async function updateProductDisplayVariantsSequential(flatVariants) {
  if (!Array.isArray(flatVariants) || flatVariants.length === 0) {
    return { ok: false, error: new Error('Không có sản phẩm để cập nhật.') }
  }
  if (!isSupabaseConfigured()) {
    return { ok: true, skipped: true, written: flatVariants.length }
  }
  let written = 0
  for (const v of flatVariants) {
    const r = await updateSingleProductFromDisplayVariant(v)
    if (!r.ok) return { ok: false, error: r.error, written }
    if (r.updated === false) {
      const ins = await insertSingleProductFromDisplayVariant(v)
      if (!ins.ok) return { ok: false, error: ins.error, written }
    }
    written += 1
  }
  return { ok: true, written }
}

/**
 * Tạo mới tuần tự: SELECT toàn bộ ma_hang từ DB → cấp mã tăng dần → INSERT từng dòng.
 */
export async function insertProductDisplayVariantsSequential(flatVariants, options = {}) {
  if (!Array.isArray(flatVariants) || flatVariants.length === 0) {
    return { ok: false, error: new Error('Không có sản phẩm để thêm.') }
  }
  if (!isSupabaseConfigured()) {
    const err = new Error('Supabase chưa cấu hình — không thể tạo sản phẩm mới.')
    console.error('Lỗi Insert Supabase:', err)
    return { ok: false, error: err }
  }

  const allDbCodes = await fetchAllMaHangCodesFromSupabase()
  const dbCodeSet = new Set(allDbCodes.map((c) => c.toLowerCase()))
  let currentMax =
    Number.isFinite(Number(options.startMaxHh)) && Number(options.startMaxHh) > 0
      ? Number(options.startMaxHh)
      : maxValidHhMaHangNumber(allDbCodes)

  const batchAssigned = new Set()
  for (const c of allDbCodes) {
    batchAssigned.add(c.toLowerCase())
  }
  const barcodeSet = new Set(
    (Array.isArray(options.existingCatalogProducts) ? options.existingCatalogProducts : [])
      .flatMap((p) => p.groupVariants || [p])
      .map((v) => String(normalizeBarcodeValue(v.barcode ?? '')).trim())
      .filter(Boolean)
  )

  const prepared = []
  for (const v of flatVariants) {
    let code = String(v.code ?? '').trim()
    const codeLc = code.toLowerCase()
    const mustAutoAssign =
      !code ||
      !isValidAutoHhMaHang(code) ||
      dbCodeSet.has(codeLc) ||
      batchAssigned.has(codeLc)

    if (mustAutoAssign) {
      let guard = 0
      do {
        currentMax += 1
        code = nextAutoHhMaHangFromMax(currentMax - 1)
        guard += 1
      } while (
        (dbCodeSet.has(code.toLowerCase()) || batchAssigned.has(code.toLowerCase())) &&
        guard < 100000
      )
    } else {
      const n = parseInt(code.replace(/^HH/i, ''), 10)
      if (Number.isFinite(n)) currentMax = Math.max(currentMax, n)
    }

    // eslint-disable-next-line no-console
    console.log('Mã chuẩn bị tạo:', code)

    batchAssigned.add(code.toLowerCase())
    dbCodeSet.add(code.toLowerCase())

    let barcode = String(normalizeBarcodeValue(v.barcode ?? '')).trim()
    if (barcode && barcodeSet.has(barcode)) barcode = ''
    if (barcode) barcodeSet.add(barcode)

    const row = { ...v, code, barcode }
    // eslint-disable-next-line no-console
    console.log('Bắt đầu gọi insertSingleProductFromDisplayVariant:', code)
    const r = await insertSingleProductFromDisplayVariant(row)
    if (!r.ok) {
      console.error('Lỗi Insert Supabase:', r.error)
      return { ok: false, error: r.error, preparedVariants: prepared, written: prepared.length }
    }
    const out = r.displayVariant ? { ...row, ...r.displayVariant, code } : row
    prepared.push(out)
  }

  return { ok: true, preparedVariants: prepared, written: prepared.length }
}

/**
 * Chỉ ghi bảng `products` — không upsert `catalog_snapshots` (CRUD sửa/tạo từng phần hàng ngày).
 * @param {Array<object>} flatDisplayVariants
 * @param {object} [options]
 * @param {Array<object>} [options.existingCatalogProducts]
 * @param {boolean} [options.useBulkInsert]
 * @param {boolean} [options.withSnapshot] — nếu `true`, ghi thêm snapshot (sao lưu định kỳ).
 */
export async function persistCatalogProductsOnly(flatDisplayVariants, options = {}) {
  if (!isSupabaseConfigured()) {
    return { ok: true, skipped: true, snapshotSaved: false, productsWritten: true }
  }
  if (!Array.isArray(flatDisplayVariants) || flatDisplayVariants.length === 0) {
    const err = new Error('Không có biến thể để ghi lên bảng products.')
    return { ok: false, error: err, snapshotSaved: false, productsWritten: false }
  }
  try {
    const r = await saveProductsToSupabaseUpsertOnly(flatDisplayVariants, {
      existingCatalogProducts: options.existingCatalogProducts ?? [],
      useBulkInsert: options.useBulkInsert === true,
    })
    if (!r.ok) {
      return {
        ok: false,
        error: r.error,
        snapshotSaved: false,
        productsWritten: false,
        written: r.written,
        skippedUpsert: r.skippedUpsert,
      }
    }
    let snapshotSaved = false
    if (options.withSnapshot === true && Array.isArray(options.existingCatalogProducts)) {
      await saveCatalogSnapshot(
        options.existingCatalogProducts,
        String(options.fileName ?? 'catalog')
      )
      snapshotSaved = true
    }
    return {
      ok: true,
      snapshotSaved,
      productsWritten: true,
      returnedDisplayVariants: r.returnedDisplayVariants,
      preparedVariants: r.preparedVariants,
      written: r.written,
      skippedUpsert: r.skippedUpsert,
    }
  } catch (error) {
    notifySupabasePersistFailure(error)
    return { ok: false, error, snapshotSaved: false, productsWritten: false }
  }
}

/**
 * Xóa biến thể khỏi DB rồi ghi snapshot — chỉ cập nhật UI sau khi gọi hàm này thành công.
 * Combo: gỡ BOM → xóa dòng `products` → snapshot (một object JSON, không phải mảng thô).
 */
export async function persistCatalogDeleteVariants(products, fileName, variantIds) {
  if (!Array.isArray(variantIds) || variantIds.length === 0) {
    return { ok: false, error: new Error('Thiếu biến thể cần xóa.') }
  }
  const prev = Array.isArray(products) ? products : []
  if (!isSupabaseConfigured()) {
    return { ok: true, snapshotSaved: true, productsWritten: true }
  }
  try {
    const dr = await deleteProductsForRemovedVariants(prev, variantIds)
    if (!dr.ok && !dr.skipped) {
      return { ok: false, error: dr.error, snapshotSaved: false, productsWritten: false }
    }
    const next = applyProductDataToCatalog(prev, { type: 'remove_variants', variantIds })
    const sr = await persistCatalogSnapshotAndProducts(next, fileName, { snapshotOnly: true })
    if (!sr.ok) {
      return {
        ok: false,
        error: sr.error,
        snapshotSaved: false,
        productsWritten: true,
        catalogNext: next,
      }
    }
    return { ok: true, snapshotSaved: true, productsWritten: true, catalogNext: next }
  } catch (error) {
    notifySupabasePersistFailure(error)
    return { ok: false, error, snapshotSaved: false, productsWritten: false }
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

function normalizeDisplayCatalogComboFields(products) {
  if (!Array.isArray(products) || products.length === 0) return []
  return products.map((p) => {
    if (Array.isArray(p.groupVariants) && p.groupVariants.length > 0) {
      const groupVariants = p.groupVariants.map((v) =>
        applyComboMetadataToDisplayVariant(normalizeDisplayVariantNumbers(v), v)
      )
      const rep =
        groupVariants.find((v) => variantIsComboForPersist(v)) ?? groupVariants[0] ?? p
      return applyComboMetadataToDisplayVariant(
        { ...normalizeDisplayVariantNumbers(p), groupVariants },
        rep
      )
    }
    const v = normalizeDisplayVariantNumbers(p)
    return applyComboMetadataToDisplayVariant(v, v)
  })
}

function normalizeDisplayCatalogNumericFields(products) {
  if (!Array.isArray(products) || products.length === 0) return []
  const nums = products.map((p) => {
    if (Array.isArray(p.groupVariants) && p.groupVariants.length > 0) {
      return {
        ...normalizeDisplayVariantNumbers(p),
        groupVariants: p.groupVariants.map(normalizeDisplayVariantNumbers),
      }
    }
    return normalizeDisplayVariantNumbers(p)
  })
  return normalizeDisplayCatalogComboFields(nums)
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
  const flat = {
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
  if (readIsComboFromProductsDbRow(row)) {
    return applyComboMetadataToDisplayVariant(flat, {
      catalogProductType: CATALOG_PRODUCT_TYPE_COMBO,
      isCombo: true,
      comboBom: parseComboBomFromProductsDbRow(row),
    })
  }
  return flat
}

/**
 * Snapshot JSON (đủ combo) + dòng `products` (giá/tồn/combo cột DB) → catalog hiển thị.
 * @param {{ products: Array, fileName: string, csvRowCount: number }} snapshotCatalog
 * @param {{ products: Array, fileName: string, csvRowCount: number }} productsCatalog
 */
function mergeSnapshotCatalogWithProductsTable(snapshotCatalog, productsCatalog) {
  const liveByCode = new Map()
  for (const p of productsCatalog.products || []) {
    for (const v of p.groupVariants || [p]) {
      const code = String(v.code ?? '').trim()
      if (code) liveByCode.set(code, v)
    }
  }

  const snapCodes = new Set()
  const mergedProducts = (snapshotCatalog.products || []).map((p) => {
    const gvs = (p.groupVariants || [p]).map((v) => {
      const code = String(v.code ?? '').trim()
      if (code) snapCodes.add(code)
      const live = liveByCode.get(code)
      if (!live) return v
      return applyComboMetadataToDisplayVariant(
        {
          ...v,
          price: live.price,
          wholesalePrice: live.wholesalePrice,
          cost: live.cost,
          stockQty: live.stockQty,
          brand: live.brand ?? v.brand,
          barcode: live.barcode ?? v.barcode,
          name: live.name ?? v.name,
          nameRaw: live.nameRaw ?? v.nameRaw,
          weightRaw: live.weightRaw ?? v.weightRaw,
        },
        live
      )
    })
    const rep = gvs[0] ?? p
    const comboRep = gvs.find((x) => x.catalogProductType === CATALOG_PRODUCT_TYPE_COMBO) ?? rep
    return applyComboMetadataToDisplayVariant(
      {
        ...p,
        ...comboRep,
        groupVariants: gvs,
      },
      comboRep
    )
  })

  /** Dòng chỉ có trên bảng `products` (chưa có trong snapshot JSON) — phải hiện cả hàng thường, không chỉ combo. */
  for (const p of productsCatalog.products || []) {
    for (const v of p.groupVariants || [p]) {
      const code = String(v.code ?? '').trim()
      if (!code || snapCodes.has(code)) continue
      mergedProducts.push(
        applyComboMetadataToDisplayVariant(
          {
            ...v,
            groupVariants: [v],
            multiUnit: false,
          },
          v
        )
      )
      snapCodes.add(code)
    }
  }

  const products = normalizeDisplayCatalogNumericFields(
    prepareCatalogForPosSearch(mergedProducts)
  )
  return {
    products,
    fileName: snapshotCatalog.fileName || productsCatalog.fileName,
    csvRowCount: countVariantRowsInProducts(products),
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
 * Chuẩn hóa catalog display → JSON an toàn cho cột `snapshot` (jsonb).
 * Không gửi mảng thô làm giá trị cột `snapshot` — luôn bọc trong object có `products`.
 */
export function sanitizeDisplayCatalogForSnapshot(products) {
  const list = Array.isArray(products) ? products : []
  try {
    return JSON.parse(
      JSON.stringify(list, (_key, value) => {
        if (typeof value === 'function') return undefined
        return value
      })
    )
  } catch (e) {
    console.warn('[catalogRepository] sanitizeDisplayCatalogForSnapshot fallback', e)
    return list.map((p) => {
      if (!p || typeof p !== 'object') return p
      const { groupVariants, ...rest } = p
      const gvs = Array.isArray(groupVariants)
        ? groupVariants.map((v) => {
            if (!v || typeof v !== 'object') return v
            const { raw, ...vr } = v
            return { ...vr, ...(raw && typeof raw === 'object' ? { raw } : {}) }
          })
        : undefined
      return gvs ? { ...rest, groupVariants: gvs } : rest
    })
  }
}

/**
 * Payload JSON lưu trong cột `snapshot` (bảng catalog_snapshots).
 * @param {Array} products — display catalog
 * @param {string} fileName
 */
export function buildCatalogSnapshotPayload(products, fileName) {
  const normalizedFileName = normalizeCatalogFileName(fileName)
  const safeProducts = sanitizeDisplayCatalogForSnapshot(products)
  return {
    v: CATALOG_SNAPSHOT_VERSION,
    fileName: normalizedFileName,
    savedAt: new Date().toISOString(),
    products: Array.isArray(safeProducts) ? safeProducts : [],
  }
}

/**
 * Một dòng PostgREST cho `catalog_snapshots` — luôn là mảng `[{ id, snapshot, updated_at }]`.
 */
export function buildCatalogSnapshotSupabaseRow(products, fileName) {
  const now = new Date().toISOString()
  const snapshot = buildCatalogSnapshotPayload(products, fileName)
  if (Array.isArray(snapshot)) {
    throw new Error(
      'Cấu trúc snapshot sai: phải là object { v, fileName, products }, không phải mảng catalog.'
    )
  }
  if (!Array.isArray(snapshot.products)) {
    throw new Error('Cấu trúc snapshot sai: thiếu mảng snapshot.products.')
  }
  return {
    id: CATALOG_SUPABASE_ROW_ID,
    snapshot,
    updated_at: now,
  }
}

/**
 * @param {Array} products
 * @param {string} fileName
 */
async function saveCatalogSnapshotToSupabase(products, fileName) {
  const sb = getSupabaseClient()
  if (!sb) return
  const row = buildCatalogSnapshotSupabaseRow(products, fileName)
  const { error } = await sb.from(CATALOG_SNAPSHOT_TABLE).upsert([row], { onConflict: 'id' })
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
    const [fromSnap, fromProducts] = await Promise.all([
      fetchCatalogSnapshotFromSupabase(),
      fetchDisplayCatalogFromSupabaseProductsTable(),
    ])
    if (fromSnap?.products?.length && fromProducts?.products?.length) {
      return mergeSnapshotCatalogWithProductsTable(fromSnap, fromProducts)
    }
    if (fromSnap?.products?.length) {
      return {
        ...fromSnap,
        products: normalizeDisplayCatalogNumericFields(fromSnap.products),
      }
    }
    if (fromProducts?.products?.length) return fromProducts
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
async function saveCatalogSnapshotInner(products, fileName) {
  const normalizedFileName = normalizeCatalogFileName(fileName)
  const dedupeKey = catalogSnapshotDedupeKey(products, normalizedFileName)
  if (dedupeKey === saveCatalogSnapshotLastOkKey) return

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
  const payload = buildCatalogSnapshotPayload(products, normalizedFileName)
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
}

/**
 * Ghi snapshot: IndexedDB (+ Supabase upsert một dòng). Lỗi Supabase được ném ra cho caller xử lý.
 */
export async function saveCatalogSnapshot(products, fileName) {
  const run = () => saveCatalogSnapshotInner(products, fileName)
  const task = saveCatalogSnapshotQueue.then(run, run)
  saveCatalogSnapshotQueue = task.catch(() => {})
  return task
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
