import { parseCsvTextToDisplayCatalog } from './catalogCsv.js'
import { persistCatalogSnapshotAndProducts } from './catalogRepository.js'
import { KIOTNEW_PRODUCT_DB_COLUMNS, PRODUCT_COL } from './kiotProductSchema.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

export { KIOTNEW_PRODUCT_DB_COLUMNS, PRODUCT_COL }

function stripAccents(s) {
  return String(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

function parseDelimitedLine(line, delimiter) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (c === delimiter && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += c
    }
  }
  cells.push(current)
  return cells
}

function detectDelimiter(headerLine) {
  if (headerLine.includes(';')) return ';'
  const bySemi = parseDelimitedLine(headerLine, ';').length
  const byComma = parseDelimitedLine(headerLine, ',').length
  if (bySemi > byComma) return ';'
  if (byComma > bySemi) return ','
  return ','
}

function splitLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

/** Chuẩn hoá tiêu đề cột CSV → tên cột bảng products */
function headerCellToDbKey(h) {
  const k = stripAccents(String(h ?? '').replace(/^\uFEFF/, '').replace(/\u00A0/g, ' ').trim()).replace(
    /\s+/g,
    ' '
  )
  const map = {
    /** Một số môi trường giữ chữ «đ» sau stripAccents — thêm alias. */
    'kh đặt': PRODUCT_COL.KH_DAT,
    'ma hang': PRODUCT_COL.MA_HANG,
    'ma vach': PRODUCT_COL.MA_VACH,
    'ten hang': PRODUCT_COL.TEN_HANG,
    'thuong hieu': PRODUCT_COL.THUONG_HIEU,
    'gia ban': PRODUCT_COL.GIA_BAN,
    'gia von': PRODUCT_COL.GIA_VON,
    'ton kho': PRODUCT_COL.TON_KHO,
    'kh dat': PRODUCT_COL.KH_DAT,
    'du kien het hang': PRODUCT_COL.DU_KIEN_HET_HANG,
    'ton nho nhat': PRODUCT_COL.TON_NHO_NHAT,
    'ton lon nhat': PRODUCT_COL.TON_LON_NHAT,
    dvt: PRODUCT_COL.DVT,
    'ma dvt co ban': PRODUCT_COL.MA_DVT_CO_BAN,
    'quy doi': PRODUCT_COL.QUY_DOI,
    'thuoc tinh': PRODUCT_COL.THUOC_TINH,
    'ma hh lien quan': PRODUCT_COL.MA_HH_LIEN_QUAN,
    'trong luong': PRODUCT_COL.TRONG_LUONG,
    'dang kinh doanh': PRODUCT_COL.DANG_KINH_DOANH,
    'duoc ban truc tiep': PRODUCT_COL.DUOC_BAN_TRUC_TIEP,
    'gia si': PRODUCT_COL.GIA_SI,
  }
  return map[k] || null
}

/**
 * Đọc nội dung CSV Kiot → mảng object khớp cột bảng `products`.
 * @param {string} text
 * @returns {{ rows: object[], headerKeys: string[], error: string | null }}
 */
export function parseKiotnewCsvToProductRows(text) {
  const lines = splitLines(text).filter((l) => l.trim() !== '')
  if (lines.length < 2) {
    return { rows: [], headerKeys: [], error: 'File CSV không đủ dòng tiêu đề + dữ liệu.' }
  }
  const delim = detectDelimiter(lines[0])
  const headerCells = parseDelimitedLine(lines[0], delim)
  const colIndexToDbKey = []
  for (let i = 0; i < headerCells.length; i++) {
    colIndexToDbKey.push(headerCellToDbKey(headerCells[i]))
  }
  const usedKeys = new Set()
  const rows = []
  const nowIso = new Date().toISOString()
  for (let r = 1; r < lines.length; r++) {
    const cells = parseDelimitedLine(lines[r], delim)
    const row = {}
    for (let c = 0; c < colIndexToDbKey.length; c++) {
      const dbk = colIndexToDbKey[c]
      if (!dbk) continue
      const raw = cells[c]
      row[dbk] = raw == null ? '' : String(raw).trim()
    }
    const ma = String(row[PRODUCT_COL.MA_HANG] ?? '').trim()
    if (!ma) continue
    for (const k of KIOTNEW_PRODUCT_DB_COLUMNS) {
      if (row[k] === undefined) row[k] = ''
    }
    row.imported_at = nowIso
    if (usedKeys.has(ma)) continue
    usedKeys.add(ma)
    rows.push(row)
  }
  if (rows.length === 0) {
    return { rows: [], headerKeys: [], error: 'Không có dòng nào có Mã hàng.' }
  }
  return { rows, headerKeys: [...KIOTNEW_PRODUCT_DB_COLUMNS, 'imported_at'], error: null }
}

function chunkArray(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * URL file CSV mặc định trên cùng origin (public/kiotnew.csv).
 */
export function getDefaultKiotnewCsvUrl() {
  const name = encodeURI('kiotnew.csv')
  const base = import.meta.env.BASE_URL || '/'
  const path = (base.endsWith('/') ? base : `${base}/`) + name
  if (typeof window === 'undefined' || !window.location?.origin) return path
  return new URL(path, window.location.origin).href
}

/**
 * @param {{ signal?: AbortSignal, onPhase?: (phase: string, detail?: string) => void }} [opts]
 */
export async function runStoreDataBootstrap(opts = {}) {
  const { signal, onPhase } = opts
  if (!isSupabaseConfigured()) {
    throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong .env).')
  }
  const sb = getSupabaseClient()
  if (!sb) throw new Error('Không khởi tạo được Supabase client.')

  onPhase?.('rpc', 'bootstrap_store_schema')
  const { error: rpcErr } = await sb.rpc('bootstrap_store_schema')
  if (signal?.aborted) {
    const e = new Error('Đã huỷ')
    e.name = 'AbortError'
    throw e
  }
  if (rpcErr) {
    const hint =
      rpcErr.message?.includes('schema cache') || rpcErr.code === 'PGRST202'
        ? ' Hãy chạy file SQL trong supabase/migrations/ trên Supabase SQL Editor (tạo hàm bootstrap_store_schema).'
        : ''
    throw new Error((rpcErr.message || 'RPC bootstrap_store_schema lỗi') + hint)
  }
  onPhase?.('fetch', 'kiotnew.csv')
  const url = getDefaultKiotnewCsvUrl()
  const res = await fetch(url, { cache: 'no-store', signal })
  if (!res.ok) throw new Error(`Không tải được ${url} (${res.status})`)
  const text = await res.text()

  onPhase?.('parse', 'CSV → hàng products + catalog')
  const { rows, error: rowErr } = parseKiotnewCsvToProductRows(text)
  if (rowErr) throw new Error(rowErr)
  const parsed = parseCsvTextToDisplayCatalog(text, 'kiotnew.csv')
  if (parsed.error) throw new Error(parsed.error)
  if (!parsed.products?.length) throw new Error('Parse danh mục POS rỗng.')

  onPhase?.('upload', 'catalog_snapshots + products (một lần)')
  await persistCatalogSnapshotAndProducts(parsed.products, 'kiotnew.csv')

  onPhase?.('done', String(rows.length))
  return { productRowCount: rows.length, displayGroupCount: parsed.products.length }
}
