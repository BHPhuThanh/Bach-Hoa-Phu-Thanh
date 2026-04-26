import { parseCsvTextToDisplayCatalog } from './catalogCsv.js'
import { saveCatalogSnapshot } from './catalogRepository.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

/** Cột DB (snake_case) theo thứ tự cột chuẩn file Kiot / kiotnew.csv */
export const KIOTNEW_PRODUCT_DB_COLUMNS = [
  'ma_hang',
  'ma_vach',
  'ten_hang',
  'thuong_hieu',
  'gia_ban',
  'gia_von',
  'ton_kho',
  'kh_dat',
  'du_kien_het_hang',
  'ton_nho_nhat',
  'ton_lon_nhat',
  'dvt',
  'ma_dvt_co_ban',
  'quy_doi',
  'thuoc_tinh',
  'ma_hh_lien_quan',
  'trong_luong',
  'dang_kinh_doanh',
  'duoc_ban_truc_tiep',
  'gia_si',
]

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
    'ma hang': 'ma_hang',
    'ma vach': 'ma_vach',
    'ten hang': 'ten_hang',
    'thuong hieu': 'thuong_hieu',
    'gia ban': 'gia_ban',
    'gia von': 'gia_von',
    'ton kho': 'ton_kho',
    'kh dat': 'kh_dat',
    'du kien het hang': 'du_kien_het_hang',
    'ton nho nhat': 'ton_nho_nhat',
    'ton lon nhat': 'ton_lon_nhat',
    dvt: 'dvt',
    'ma dvt co ban': 'ma_dvt_co_ban',
    'quy doi': 'quy_doi',
    'thuoc tinh': 'thuoc_tinh',
    'ma hh lien quan': 'ma_hh_lien_quan',
    'trong luong': 'trong_luong',
    'dang kinh doanh': 'dang_kinh_doanh',
    'duoc ban truc tiep': 'duoc_ban_truc_tiep',
    'gia si': 'gia_si',
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
    const ma = String(row.ma_hang ?? '').trim()
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

  const CHUNK = 400
  const allow = new Set([...KIOTNEW_PRODUCT_DB_COLUMNS, 'imported_at'])
  for (let i = 0; i < rows.length; i += CHUNK) {
    if (signal?.aborted) {
      const e = new Error('Đã huỷ')
      e.name = 'AbortError'
      throw e
    }
    const part = rows.slice(i, i + CHUNK).map((row) => {
      const o = {}
      for (const k of allow) o[k] = row[k] ?? ''
      return o
    })
    onPhase?.('upload', `${Math.min(i + CHUNK, rows.length)} / ${rows.length}`)
    const { error: upErr } = await sb.from('products').upsert(part, { onConflict: 'ma_hang' })
    if (upErr) throw new Error(upErr.message || 'Lỗi ghi bảng products')
  }

  onPhase?.('snapshot', 'catalog_snapshots')
  await saveCatalogSnapshot(parsed.products, 'kiotnew.csv')

  onPhase?.('done', String(rows.length))
  return { productRowCount: rows.length, displayGroupCount: parsed.products.length }
}
