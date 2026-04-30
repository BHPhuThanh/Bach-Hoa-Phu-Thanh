import { parseCsvTextToDisplayCatalog } from './catalogCsv.js'
import { persistCatalogSnapshotAndProducts } from './catalogRepository.js'
import {
  BHPHUTHANH_SEMICOLON_CSV_DVT_INDEX,
  BHPHUTHANH_SEMICOLON_CSV_QUY_DOI_INDEX,
  BHPHUTHANH_SEMICOLON_CSV_TON_KHO_INDEX,
  CATALOG_PRODUCT_DB_COLUMNS,
} from './kiotProductSchema.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

/** Chuỗi ô tồn CSV → chuỗi số hợp lệ cho `ton_kho` (parseFloat). */
function normalizeTonKhoCellRaw(raw) {
  const s = String(raw ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s/g, '')
    .trim()
  if (!s) return ''
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n)) return s
  return Number.isInteger(n) ? String(Math.trunc(n)) : String(n)
}

export { CATALOG_PRODUCT_DB_COLUMNS }

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

function normalizeBarcodeReadCell(raw) {
  return String(raw ?? '').trim()
}

/** Chuẩn hoá tiêu đề cột CSV → tên cột bảng products */
function headerCellToDbKey(h) {
  const k = stripAccents(String(h ?? '').replace(/^\uFEFF/, '').replace(/\u00A0/g, ' ').trim())
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
  const map = {
    'ma hang': 'ma_hang',
    'ma vach': 'ma_vach',
    'ten hang': 'ten_hang',
    'thuong hieu': 'thuong_hieu',
    'gia ban': 'gia_ban',
    'gia von': 'gia_von',
    'ton kho': 'ton_kho',
    'ton nho nhat': 'ton_nho_nhat',
    'ton lon nhat': 'ton_lon_nhat',
    dvt: 'dvt',
    'ma dvt co ban': 'ma_dvt_co_ban',
    'quy doi': 'quy_doi',
    'ma hh lien quan': 'ma_hh_lien_quan',
    'trong luong': 'trong_luong',
    'gia si': 'gia_si',
  }
  return map[k] || null
}

/**
 * Đọc CSV danh mục (bhphuthanh.csv…) → mảng object khớp cột bảng `products`.
 * @param {string} text
 * @returns {{ rows: object[], headerKeys: string[], error: string | null }}
 */
export function parseCatalogCsvToProductRows(text) {
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
  for (let r = 1; r < lines.length; r++) {
    const cells = parseDelimitedLine(lines[r], delim)
    const row = {}
    for (let c = 0; c < colIndexToDbKey.length; c++) {
      const dbk = colIndexToDbKey[c]
      if (!dbk) continue
      const raw = cells[c]
      if (dbk === 'ma_vach') {
        row[dbk] = normalizeBarcodeReadCell(raw)
      } else {
        row[dbk] = raw == null ? '' : String(raw).trim()
      }
    }
    if (delim === ';' && cells.length > BHPHUTHANH_SEMICOLON_CSV_QUY_DOI_INDEX) {
      row.dvt = String(cells[BHPHUTHANH_SEMICOLON_CSV_DVT_INDEX] ?? '').trim()
      row.quy_doi = String(cells[BHPHUTHANH_SEMICOLON_CSV_QUY_DOI_INDEX] ?? '').trim()
    }
    /* Cột G (index 6) `ton_kho` — đồng bộ layout bhphuthanh.csv dấu `;` */
    if (delim === ';' && cells.length > BHPHUTHANH_SEMICOLON_CSV_TON_KHO_INDEX) {
      row.ton_kho = normalizeTonKhoCellRaw(cells[BHPHUTHANH_SEMICOLON_CSV_TON_KHO_INDEX])
    }
    const ma = String(row[PRODUCT_COL.MA_HANG] ?? '').trim()
    if (!ma) continue
    for (const k of CATALOG_PRODUCT_DB_COLUMNS) {
      if (row[k] === undefined) row[k] = ''
    }
    if (usedKeys.has(ma)) continue
    usedKeys.add(ma)
    rows.push(row)
  }
  if (rows.length === 0) {
    return { rows: [], headerKeys: [], error: 'Không có dòng nào có Mã hàng.' }
  }
  return { rows, headerKeys: [...CATALOG_PRODUCT_DB_COLUMNS], error: null }
}

function chunkArray(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * URL file CSV mặc định trên cùng origin (public/bhphuthanh.csv).
 */
export function getBhphuthanhCsvUrl() {
  const name = encodeURI('bhphuthanh.csv')
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
  onPhase?.('fetch', 'bhphuthanh.csv')
  const url = getBhphuthanhCsvUrl()
  const res = await fetch(url, { cache: 'no-store', signal })
  if (!res.ok) throw new Error(`Không tải được ${url} (${res.status})`)
  const text = await res.text()

  onPhase?.('parse', 'CSV → hàng products + catalog')
  const { rows, error: rowErr } = parseCatalogCsvToProductRows(text)
  if (rowErr) throw new Error(rowErr)
  const parsed = parseCsvTextToDisplayCatalog(text, 'bhphuthanh.csv')
  if (parsed.error) throw new Error(parsed.error)
  if (!parsed.products?.length) throw new Error('Parse danh mục POS rỗng.')

  onPhase?.('upload', 'catalog_snapshots + products (một lần)')
  await persistCatalogSnapshotAndProducts(parsed.products, 'bhphuthanh.csv')

  onPhase?.('done', String(rows.length))
  return { productRowCount: rows.length, displayGroupCount: parsed.products.length }
}
