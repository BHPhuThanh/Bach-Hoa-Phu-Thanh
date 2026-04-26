/**
 * Đẩy CSV: snapshot POS → bảng `catalog_snapshots`; đồng thời (nếu parse được) các dòng phẳng → `products`.
 *
 * Biến môi trường (PowerShell ví dụ):
 *   $env:SUPABASE_URL="https://xxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."   # hoặc SUPABASE_ANON_KEY nếu RLS cho phép ghi
 *   node scripts/push-catalog-to-supabase.mjs "C:\path\to\data.csv"
 *
 * Hoặc đặt VITE_* trong file `.env` ở thư mục gốc — script tự đọc nhẹ (không cần gói dotenv).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseCsvTextToDisplayCatalog } from '../src/catalogCsv.js'
import { parseKiotnewCsvToProductRows } from '../src/storeBootstrap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const CATALOG_SNAPSHOT_VERSION = 1
const CATALOG_ROW_ID = 'catalog'
const CATALOG_SNAPSHOT_TABLE = 'catalog_snapshots'

function loadEnvFile() {
  const p = path.join(root, '.env')
  if (!existsSync(p)) return
  const txt = readFileSync(p, 'utf8')
  for (const line of txt.split(/\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq <= 0) continue
    const k = s.slice(0, eq).trim()
    let v = s.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
}

function resolveCsvPath() {
  const arg = process.argv[2]
  const candidates = [
    arg && path.isAbsolute(arg) ? arg : arg ? path.join(process.cwd(), arg) : null,
    path.join(root, 'data.csv'),
    path.join(root, 'public', 'kiotnew.csv'),
    path.join(root, 'public', 'Kiotnew csv.csv'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  throw new Error(
    `Không tìm thấy CSV. Truyền đường dẫn: node scripts/push-catalog-to-supabase.mjs ./data.csv (đã thử: ${candidates.join(', ')})`
  )
}

loadEnvFile()

const url =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''

if (!url.trim() || !key.trim()) {
  console.error(
    'Thiếu SUPABASE_URL (hoặc VITE_SUPABASE_URL) và key (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY).'
  )
  process.exit(1)
}

const csvPath = resolveCsvPath()
const text = readFileSync(csvPath, 'utf8')
const fileName = path.basename(csvPath)
const parsed = parseCsvTextToDisplayCatalog(text, fileName)

if (parsed.error) {
  console.error('Parse CSV lỗi:', parsed.error)
  process.exit(1)
}
if (!parsed.products?.length) {
  console.error('Không có sản phẩm sau khi parse.')
  process.exit(1)
}

const now = new Date().toISOString()
const snapshot = {
  v: CATALOG_SNAPSHOT_VERSION,
  fileName,
  savedAt: now,
  products: parsed.products,
}

const sb = createClient(url.trim(), key.trim())

const { error } = await sb.from(CATALOG_SNAPSHOT_TABLE).upsert(
  {
    id: CATALOG_ROW_ID,
    snapshot,
    updated_at: now,
  },
  { onConflict: 'id' }
)

if (error) {
  console.error('Upsert catalog_snapshots thất bại:', error.message, error)
  process.exit(1)
}

const flat = parseKiotnewCsvToProductRows(text)
if (!flat.error && flat.rows.length > 0) {
  const CHUNK = 400
  for (let i = 0; i < flat.rows.length; i += CHUNK) {
    const part = flat.rows.slice(i, i + CHUNK)
    const { error: pe } = await sb.from('products').upsert(part, { onConflict: 'ma_hang' })
    if (pe) {
      console.error('Upsert products (dòng phẳng):', pe.message, pe)
      process.exit(1)
    }
  }
  console.log('  Đã ghi', flat.rows.length, 'dòng vào bảng `products`.')
} else if (flat.error) {
  console.warn('  Bỏ qua bảng products:', flat.error)
}

console.log('OK — snapshot POS → `catalog_snapshots` (id = catalog).')
console.log('  File:', fileName)
console.log('  Dòng dữ liệu CSV (data):', parsed.rowCount)
console.log('  Nhóm sản phẩm (display):', parsed.products.length)
